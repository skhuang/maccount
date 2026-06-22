// Google is OpenID Connect / OAuth2. We bind a Google account to get a stable
// identity (`sub`) + email AND offline access to the student's Drive (a refresh
// token), so staff can share / manage Google Cloud / Drive files later. The
// scope is configurable (see GOOGLE_SCOPE); the default uses `drive.file`
// (per-file, app-created access — a non-restricted scope, no Google security
// assessment), plus `openid email` for identity.
export const DEFAULT_GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/drive.file";

export function googleAuthorizeUrl(
  clientId: string, redirectUri: string, state: string, scope: string,
  opts: { offline?: boolean } = {},
): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope);
  u.searchParams.set("state", state);
  // Binding wants offline + forced consent → Google returns a refresh token (it
  // only does so on consent). Login just identifies the user (no refresh token
  // needed), so it skips offline/consent and only offers the account chooser.
  if (opts.offline ?? true) {
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent select_account");
  } else {
    u.searchParams.set("prompt", "select_account");
  }
  return u.toString();
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null; // present on consent; absent if Google withheld it
  scope: string | null;
  expiresIn: number | null;
}

export async function exchangeGoogleCode(
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const data = (await res.json()) as {
    access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string;
  };
  if (!data.access_token) throw new Error(`google token exchange: ${data.error ?? "no token"}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    scope: data.scope ?? null,
    expiresIn: data.expires_in ?? null,
  };
}

// Mint a fresh access token from a stored refresh token (Drive ops use this; the
// refresh token itself doesn't expire unless revoked). Google does not return a
// new refresh token here.
export async function refreshGoogleAccessToken(
  opts: { clientId: string; clientSecret: string; refreshToken: string },
  fetcher: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number | null }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) throw new Error(`google token refresh: ${data.error ?? "no token"}`);
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
}

export async function fetchGoogleUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ sub: string; email: string }> {
  const res = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`google userinfo failed: ${res.status}`);
  const data = (await res.json()) as { sub?: string; email?: string };
  // `sub` is Google's stable per-user id (the binding key); `email` is what we
  // store/show. We trust the email Google returns for an `openid email` grant.
  if (!data.sub || !data.email) throw new Error("google userinfo: missing sub or email");
  return { sub: data.sub, email: data.email };
}
