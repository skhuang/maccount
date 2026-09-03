export interface LineConfig {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
}

function base64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function linePkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function lineAuthorizeUrl(
  config: LineConfig,
  state: string,
  nonce: string,
  codeChallenge: string,
): string {
  const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.channelId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeLineCode(
  config: LineConfig,
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.channelId,
    client_secret: config.channelSecret,
    code_verifier: codeVerifier,
  });
  const response = await fetcher("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`line token exchange failed: ${response.status}`);
  const data = (await response.json()) as { id_token?: string; error?: string };
  if (!data.id_token) throw new Error(`line token exchange: ${data.error ?? "no id token"}`);
  return data.id_token;
}

export async function verifyLineIdToken(
  channelId: string,
  idToken: string,
  nonce: string,
  fetcher: typeof fetch = fetch,
): Promise<{ sub: string; name: string }> {
  const response = await fetcher("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId, nonce }).toString(),
  });
  if (!response.ok) throw new Error(`line id token verification failed: ${response.status}`);
  const data = (await response.json()) as { sub?: string; name?: string };
  if (!data.sub) throw new Error("line id token verification: missing sub");
  return { sub: data.sub, name: data.name?.trim() || "LINE user" };
}
