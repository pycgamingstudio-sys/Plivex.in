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
  // PLIVEX ONE has one runtime and one public workspace identity. The workspace
  // country controls regional settings; it never switches the user into a second app.
  if (isUnifiedBuild) {
    // PLIVEX ONE: every country uses the same canonical public workspace
    // identity. Country only selects regional settings; Global schema membership
    // must never replace the user's public profile/workspace or runtime.
    const countryCode = String(currentUser?.country_code || "").trim().toUpperCase();
    const supportedCountries = new Set(listSelectableCountries().map((country) => country.code));
    if (countryCode && !supportedCountries.has(countryCode)) {
      throw new Error("This workspace country is not supported yet. Your existing data has not been changed.");
    }
    setRuntimeEdition("india");
    return {
      ...currentUser,
      ...(currentUser?.workspace_id && !countryCode ? { country_code: "IN" } : {}),
    };
  }
  const existingCountry = String(currentUser?.country_code || "").trim().toUpperCase();
  if (!isUnifiedBuild && APP_EDITION !== "global" && (!existingCountry || existingCountry === "IN")) return currentUser;

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
  // Always ask the server whether this identity has a Global workspace.
  // Legacy India profiles can still carry country_code=IN for a user whose
  // actual Global workspace is US/GB/etc.; a successful Global context wins.
  // If no Global membership exists, an explicit India profile remains India.
  const shouldResolveGlobal = APP_EDITION === "global" || isUnifiedBuild || countryCode !== 'IN';
  if (shouldResolveGlobal) {
    const { data: globalContext, error: globalError } = await supabase.functions.invoke('global-auth-context', { body: {} });
    if (!globalError && globalContext?.user?.id === currentUser?.id) {
      globalUser = globalContext.user;
      countryCode = globalUser.country_code || countryCode;
    } else if (APP_EDITION === "global" || (countryCode && countryCode !== 'IN')) {
      throw new Error('Your Global workspace could not be verified. Your existing data has not been changed.');
    }
    // Existing India accounts with no Global membership fall back to India;
    // new accounts continue to the explicit country onboarding screen.
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
  setRuntimeEdition(edition, { verifiedGlobal: edition === "global" && Boolean(globalUser) });
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
      if (isUnifiedBuild || APP_EDITION === "global" || (currentUser?.country_code && String(currentUser.country_code).trim().toUpperCase() !== "IN")) {
        currentUser = await resolveSignedInEdition(currentUser);
      }

      // Unified signup is authenticated first; provisioning waits for completed onboarding.
      if (isUnifiedBuild && !currentUser?.workspace_id && !getPendingInviteCode()) {
        setUser(currentUser); signedInRef.current = true; setIsAuthenticated(true);
        setAuthError(null); setIsLoadingAuth(false); setAuthChecked(true); return;
      }
      // Existing authenticated sessions must stop before hydrating business data
      // until the owner has completed the current one-Workspace migration review.
      // The auth session and workspace ID stay intact; this is not a new signup.
      if (isUnifiedBuild && currentUser?.workspace_id && (
        Number(currentUser?.onboarding_version || 0) < 1
        || currentUser?.migration_status !== "ready"
        || currentUser?.legacy_review_required === true
      )) {
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
