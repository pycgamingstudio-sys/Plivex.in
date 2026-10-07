import React, { createContext, useState, useContext, useEffect, useRef } from 'react';

import { backend as db, supabase } from '@/api/backendClient';
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
          const r = await db.functions.invoke('ensureOwnerRole');
          if (r?.data?.ok) currentUser = (await db.auth.me()) || currentUser;
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
    setTenantId(null);
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
