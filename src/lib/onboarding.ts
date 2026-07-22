const PENDING_KEY = "draftly_onboarding_pending";
const doneKey = (userId: string) => `draftly_onboarding_done:${userId}`;

export function markOnboardingPending(userId: string) {
  try {
    localStorage.setItem(PENDING_KEY, userId);
  } catch {
    // ignore
  }
}

export function clearOnboardingPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export function isOnboardingPendingFor(userId: string): boolean {
  try {
    if (localStorage.getItem(doneKey(userId))) return false;
    return localStorage.getItem(PENDING_KEY) === userId;
  } catch {
    return false;
  }
}

export function markOnboardingDone(userId: string) {
  try {
    localStorage.setItem(doneKey(userId), "1");
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}
