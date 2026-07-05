// Fetch wrapper: bearer token, timeouts, {error} unwrapping, auth-expiry event.

const TOKEN_KEY = "shoepos.auth-token.v1";

export class ApiError extends Error {
  status: number;
  isNetwork: boolean;
  constructor(message: string, status = 0, isNetwork = false) {
    super(message);
    this.status = status;
    this.isNetwork = isNetwork;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? (method === "GET" ? 20_000 : 12_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ApiError("Couldn't reach the server — this wasn't saved.", 0, true);
    }
    if (response.status === 401) {
      setToken(null);
      window.dispatchEvent(new CustomEvent("auth-expired"));
      throw new ApiError("Session expired. Sign in again.", 401);
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* empty body */
    }
    if (!response.ok) {
      const message =
        (payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : `Request failed (${response.status})`);
      throw new ApiError(message, response.status);
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}
