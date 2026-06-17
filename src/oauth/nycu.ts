export interface NycuConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export function nycuAuthorizeUrl(
  cfg: NycuConfig, redirectUri: string, state: string, forceLogin = false,
): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  // Force a fresh credential prompt (used by logout→switch-account) so NYCU's SSO
  // doesn't silently re-log-in the same user. Best-effort: ignored by IdPs that
  // don't honor it. Omitted on normal login so students keep SSO convenience.
  if (forceLogin) u.searchParams.set("prompt", "login");
  return u.toString();
}

export async function exchangeNycuCode(
  cfg: NycuConfig,
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetcher(cfg.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`nycu token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("nycu token exchange: no token");
  return data.access_token;
}

export async function fetchNycuUser(
  cfg: NycuConfig,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; name: string }> {
  const res = await fetcher(cfg.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`nycu userinfo failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  // NYCU claim 名稱待與 NYCU 確認；此處集中映射，上線前若不同只改這幾行。
  const id = String(data.username ?? data.sub ?? data.id ?? "");
  const name = String(data.name ?? data.displayName ?? id);
  if (!id) throw new Error("nycu userinfo: missing id claim");
  return { id, name };
}
