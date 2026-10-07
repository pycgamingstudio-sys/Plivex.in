export function getPendingInviteCode(value = '') {
  const params = new URLSearchParams(window.location.search);
  let stored = '', intent = '';
  try { stored = localStorage.getItem('plivex:pendingInvite') || ''; intent = sessionStorage.getItem('plivex:signupIntent') || ''; } catch { /* URL carry-through still works when storage is unavailable. */ }
  return (value.trim() || params.get('invite_token') || params.get('invite_code') || stored || (intent !== 'independent' ? intent : '')).trim().toUpperCase();
}

export function rememberPendingInviteCode(code) {
  if (code) localStorage.setItem('plivex:pendingInvite', code);
  sessionStorage.setItem('plivex:signupIntent', code || 'independent');
}

export function clearPendingInviteCode() {
  localStorage.removeItem('plivex:pendingInvite');
  sessionStorage.removeItem('plivex:signupIntent');
  const url = new URL(window.location.href);
  url.searchParams.delete('invite_token'); url.searchParams.delete('invite_code');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

export function inviteAwareReturnTo(returnTo, code) {
  const url = new URL(returnTo, window.location.origin);
  if (code) url.searchParams.set('invite_token', code);
  return url.pathname + url.search + url.hash;
}

export function authPageLink(path, returnTo, code) {
  const params = new URLSearchParams();
  if (returnTo !== '/') params.set('returnTo', returnTo);
  if (code) params.set('invite_token', code);
  return path + (params.size ? '?' + params.toString() : '');
}
