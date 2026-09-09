export interface CsConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export function csAuthorizeUrl(cfg: CsConfig, redirectUri: string, state: string): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCsCode(
  cfg: CsConfig, code: string, redirectUri: string, fetcher: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: redirectUri,
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  const res = await fetcher(cfg.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`cs token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("cs token exchange: no token");
  return data.access_token;
}

export async function fetchCsUser(
  cfg: CsConfig, accessToken: string, fetcher: typeof fetch = fetch,
): Promise<{ sub: string; student_id: string; account: string; name: string }> {
  const res = await fetcher(cfg.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`cs userinfo failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  // CS OIDC claim names — confirm against a real token at integration; change
  // ONLY these lines if different. `sub` is the OIDC stable subject (→ cs_sub);
  // the 學號 is carried by the CS directory (try the likely claim names);
  // `account` is the CS login handle (csid).
  const sub = String(data.sub ?? "");
  const student_id = String(data.studentId ?? data.student_id ?? data.studentid ?? data.username ?? "");
  const account = String(data.csid ?? data.preferred_username ?? data.username ?? sub);
  const name = String(data.name ?? data.displayName ?? account);
  if (!sub) throw new Error("cs userinfo: missing sub");
  if (!student_id) throw new Error("cs userinfo: missing student id claim");
  return { sub, student_id, account, name };
}
