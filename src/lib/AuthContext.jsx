import React, { createContext, useState, useContext, useEffect, useRef } from 'react';

import { backend as db, supabase, APP_EDITION } from '@/api/backendClient';
import { hydrateWorkspaceData, resetWorkspaceCache } from '@/lib/stores';
import { clearSessionCache } from '@/lib/sessionCache';
import { setTenantId } from '@/lib/stores';

import { getPendingInviteCode, rememberPendingInviteCode, clearPendingInviteCode, authPageLink } from '@/components/auth/workspaceInvite';

const AuthContext = createContext();

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
      let currentUser = await db.auth.me();

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
        await hydrateWorkspaceData();
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
              signupRegion = { countryCode: parsedRegion.countryCode, localeCode: parsedRegion.localeCode };
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
    clearSessionCache();
    resetWorkspaceCache();
    setTenantId(null, { migrateLegacy: APP_EDITION !== 'global' });
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
