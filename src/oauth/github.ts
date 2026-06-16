export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "read:user");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeGithubCode(
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const res = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`github token exchange: ${data.error ?? "no token"}`);
  return data.access_token;
}

export async function fetchGithubUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ id: number; login: string }> {
  const res = await fetcher("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "maccount",
    },
  });
  if (!res.ok) throw new Error(`github user fetch failed: ${res.status}`);
  const data = (await res.json()) as { id?: number; login?: string };
  if (typeof data.id !== "number" || !data.login) {
    throw new Error("github user fetch: missing id or login");
  }
  return { id: data.id, login: data.login };
}
