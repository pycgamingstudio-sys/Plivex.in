export const WELCOME_POPUP_SEEN_KEY_PREFIX = "plivex:welcomeSeen:";

export function welcomePopupSeenKey(userId) {
  return userId ? WELCOME_POPUP_SEEN_KEY_PREFIX + userId : null;
}

export function canScheduleWelcomePopup({ userId, planLoading, storage }) {
  if (!userId || planLoading || !storage) return false;
  try { return storage.getItem(welcomePopupSeenKey(userId)) !== "1"; }
  catch { return false; }
}

export function isWelcomePopupVisible({ activeUserId, openForUser, planLoading }) {
  return Boolean(activeUserId && !planLoading && openForUser === activeUserId);
}

export function markWelcomePopupDismissed({ userId, storage }) {
  if (!userId || !storage) return false;
  try { storage.setItem(welcomePopupSeenKey(userId), "1"); return true; }
  catch { return false; }
}