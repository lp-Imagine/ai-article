/** Clear invalid session cookie and hard-navigate to login (stops effect retry loops). */
export async function clearSessionAndGoLogin(nextPath?: string) {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  const qs = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  window.location.replace(`/login${qs}`);
}

export function isUnauthorizedResponse(res: Response, json?: { code?: number } | null) {
  return res.status === 401 || json?.code === 401;
}
