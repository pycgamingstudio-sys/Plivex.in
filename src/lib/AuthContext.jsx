import React, { createContext, useState, useContext, useEffect, useRef } from 'react';

import { backend as db, supabase, APP_EDITION, isUnifiedBuild, setRuntimeEdition } from '@/api/backendClient';
import { resolveWorkspaceEdition } from '@/global/core/edition-contract.js';
import { listSelectableCountries } from '@/global/countries/country-registry.js';
import { hydrateWorkspaceData, resetWorkspaceCache } from '@/lib/stores';
import { clearSessionCache } from '@/lib/sessionCache';
import { setTenantId } from '@/lib/stores';

import { getPendingInviteCode, rememberPendingInviteCode, clearPendingInviteCode, authPageLink } from '@/components/auth/workspaceInvite';

const AuthContext = createContext();

// A single Supabase login is resolved to its workspace's country after sign-in.
// Existing India accounts with no country stamp remain India; non-India accounts
// must resolve to an explicitly supported country before Global handlers are used.
async function resolveSignedInEdition(currentUser) {
  if (!isUnifiedBuild && APP_EDITION !== "global") return currentUser;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  // The server-maintained workspace profile is authoritative. Auth user_metadata
  // is user-editable and is only a legacy signup fallback, never the source of truth.
  const profileCountry = currentUser?.country_code;
  const metadataCountry = authData?.user?.user_metadata?.signup_country_code;
  let countryCode = typeof profileCountry === 'string' && profileCountry.trim()
    ? profileCountry.trim().toUpperCase()
    : typeof metadataCountry === 'string' ? metadataCountry.trim().toUpperCase() : '';
  if (!countryCode) {
    try {
      const pendingRegion = JSON.parse(window.localStorage.getItem('plivex.signup.region') || 'null');
      if (typeof pendingRegion?.countryCode === 'string') countryCode = pendingRegion.countryCode.trim().toUpperCase();
    } catch { /* ignore malformed or stale signup preferences */ }
  }

  // Existing India workspaces predate country stamping and remain on India.
  if (currentUser?.workspace_id && !countryCode && APP_EDITION !== "global") countryCode = 'IN';

  let globalUser = null;
  // Non-India identities are checked against the Global context. New users
  // without a workspace may continue to the explicit onboarding screen.
  const hasWorkspaceMembership = Boolean(currentUser?.workspace_id && currentUser?.role);
  const shouldResolveGlobal = APP_EDITION === "global" || countryCode !== 'IN';
  if (shouldResolveGlobal) {
    // Query Global membership for every non-India identity. The India profile
    // adapter cannot see a Global-only workspace, so currentUser may have no
    // workspace_id even after Global provisioning has completed.
    const { data: globalContext, error: globalError } = await supabase.functions.invoke('global-auth-context', { body: {} });
    if (!globalError && globalContext?.user?.id === currentUser?.id) {
      globalUser = globalContext.user;
      countryCode = globalUser.country_code || countryCode;
    } else if (APP_EDITION === "global" || hasWorkspaceMembership || (profileCountry && profileCountry.toUpperCase() !== 'IN')) {
      throw new Error('Your Global workspace could not be verified. Your existing data has not been changed.');
    }
    // A new account with no workspace is allowed through to the explicit
    // country onboarding screen; that screen provisions the Global workspace.
  }

  // New identities without a workspace must complete shared onboarding first.
  if (!currentUser?.workspace_id && !currentUser?.role && !countryCode) {
    setRuntimeEdition('india');
    return currentUser;
  }
  // Existing unstamped workspaces remain India; never infer country from IP.
  if (!countryCode) countryCode = 'IN';
  const supportedCodes = listSelectableCountries().map((country) => country.code);
  const edition = resolveWorkspaceEdition(countryCode, supportedCodes);
  if (!edition) throw new Error('This business country is not supported yet. Your account data has not been changed.');
  setRuntimeEdition(edition);
  return edition === 'global' && globalUser ? { ...currentUser, ...globalUser } : currentUser;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  const signedInRef = useRef(false);
  const checkingRef = useRef(false);

  useEffect(() => {
    checkAppState();
    // Picks up the session created when a user clicks the email confirmation link.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && !signedInRef.current) checkUserAuth();
      if (event === 'SIGNED_OUT') { signedInRef.current = false; }
    });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  // Never let a stalled network/auth request leave the app stuck on a blank loading screen.
  // This releases the public UI after 15 seconds; a slower auth check may still finish later.
  useEffect(() => {
    if (!isLoadingAuth && !isLoadingPublicSettings) return undefined;
    const startupTimeout = window.setTimeout(() => {
      console.error('[Plivex] Startup checks exceeded 15 seconds; releasing the loading screen.');
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
      setAuthChecked(true);
    }, 15000);
    return () => window.clearTimeout(startupTimeout);
  }, [isLoadingAuth, isLoadingPublicSettings]);

  // Checks whether a signed-in session exists (no separate "app settings" call is needed any more).
  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        await checkUserAuth();
      } else {
        setIsLoadingAuth(false);
        setIsAuthenticated(false);
        setAuthChecked(true);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({ type: 'unknown', message: error.message || 'An unexpected error occurred' });
      setIsLoadingAuth(false);
    } finally {
      setIsLoadingPublicSettings(false);
    }
  };

  // Apply pending workspace invites before considering standalone-owner provisioning.
  // Google, email login, and registration all restore the same invitation context.
  const applyPendingInvite = async (currentUser) => {
    const code = getPendingInviteCode();
    if (!code) return { user: currentUser, pendingInvite: false };
    rememberPendingInviteCode(code);
    const response = await db.functions.invoke('verifyInviteCode', { code, email: currentUser?.email });
    if (!response?.data?.ok) throw new Error(response?.data?.error || 'Your workspace invite could not be applied.');
    clearPendingInviteCode();
    return { user: await db.auth.me(), pendingInvite: true };
  };

  const checkUserAuth = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try { await runCheckUserAuth(); } finally { checkingRef.current = false; }
  };

  const runCheckUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      if (isUnifiedBuild) setRuntimeEdition('india');
      let currentUser = await db.auth.me();
      if (isUnifiedBuild || APP_EDITION === "global") currentUser = await resolveSignedInEdition(currentUser);

      // Unified signup is authenticated first; provisioning waits for completed onboarding.
      if (isUnifiedBuild && !currentUser?.workspace_id && !getPendingInviteCode()) {
        setUser(currentUser); signedInRef.current = true; setIsAuthenticated(true);
        setAuthError(null); setIsLoadingAuth(false); setAuthChecked(true); return;
      }
      // Global identity and workspace authorization are read only from Global RPCs.
      // Never consult India public.profiles, invites, or workspace-record endpoints.
      if (APP_EDITION === "global") {
        const pendingGlobalInvite = getPendingInviteCode();
        if (pendingGlobalInvite) {
          throw new Error("Global workspace invitations are not available yet. Remove the invite link and sign in with your own Global account.");
        }
        // Require an explicit business-country choice before provisioning a new Global workspace.
        if (!currentUser?.workspace_id || !currentUser?.role) {
          setUser(currentUser);
          signedInRef.current = true;
          setIsAuthenticated(true);
          setAuthError(null);
          setIsLoadingAuth(false);
          setAuthChecked(true);
          return;
        }
        setTenantId(`global:${currentUser.id}`, { migrateLegacy: false });
        resetWorkspaceCache();
        // Global workspace hydration is routed through the isolated Global records adapter.
        if (currentUser?.workspace_id) await hydrateWorkspaceData();
        setUser(currentUser);
        signedInRef.current = true;
        setIsAuthenticated(true);
        setAuthError(null);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      // 1) Invited members join the inviter's workspace first. If the invite is
      //    still pending and fails, never fall through to creating a separate owner workspace.
      let hadInvite = false;
      try {
        const applied = await applyPendingInvite(currentUser);
        currentUser = applied.user || currentUser;
        hadInvite = applied.pendingInvite;
      } catch (inviteError) {
        console.error('Pending workspace invite could not be applied:', inviteError);
        hadInvite = true;
      }

      // 2) Standalone accounts become Business Owner of their own workspace.
      if (!hadInvite && (!currentUser?.workspace_id || !currentUser?.role || currentUser.role === 'user')) {
        try {
          let signupRegion = {};
          try {
            const rawRegion = window.localStorage.getItem('plivex.signup.region');
            const parsedRegion = rawRegion ? JSON.parse(rawRegion) : null;
            if (parsedRegion && typeof parsedRegion.countryCode === 'string' && typeof parsedRegion.localeCode === 'string') {
              signupRegion = { countryCode: parsedRegion.countryCode, localeCode: parsedRegion.localeCode, businessName: typeof parsedRegion.businessName === "string" ? parsedRegion.businessName.slice(0, 160) : "" };
            }
          } catch { /* ignore stale or malformed local signup preference */ }
          const r = await db.functions.invoke('ensureOwnerRole', signupRegion);
          if (r?.data?.ok) {
            try { window.localStorage.removeItem('plivex.signup.region'); } catch {}
            currentUser = (await db.auth.me()) || currentUser;
          }
        } catch (ownerError) {
          console.error('Owner role bootstrap failed:', ownerError);
        }
      }

      setTenantId(currentUser?.id);
      // Load this workspace's invoices, clients, stock etc. from the server before any screen opens.
      if (currentUser?.workspace_id) { await hydrateWorkspaceData(); }
      setUser(currentUser);
      signedInRef.current = true;
      setIsAuthenticated(true);
      setAuthError(null);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      if (error?.status === 401 || error?.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
      setAuthChecked(true);
    }
  };

  const logout = (shouldRedirect = true) => {
    const wasGlobalWorkspace = APP_EDITION === 'global';
    if (isUnifiedBuild) setRuntimeEdition('india');
    clearSessionCache();
    resetWorkspaceCache();
    setTenantId(null, { migrateLegacy: !wasGlobalWorkspace });
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      db.auth.logout(window.location.origin + '/');
    } else {
      db.auth.logout();
    }
  };

  const navigateToLogin = () => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = authPageLink('/login', returnTo || '/', getPendingInviteCode());
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      authChecked,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
