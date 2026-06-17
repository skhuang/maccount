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

// Invite/add a user to the course org. Returns the membership `state` ("pending"
// = invitation sent, accepted once at github.com/orgs/<org>/invitation; "active"
// = already a member). Needs an org-scoped token (Members: write).
export async function inviteOrgMember(
  org: string, username: string, token: string,
  fetcher: typeof fetch = fetch,
): Promise<{ state?: string }> {
  const res = await fetcher(`https://api.github.com/orgs/${org}/memberships/${username}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "maccount",
    },
    body: JSON.stringify({ role: "member" }),
  });
  if (!res.ok) throw new Error(`org invite failed: ${res.status}`);
  return (await res.json()) as { state?: string };
}

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "maccount",
  };
}

// Add a user to an org team (role member). For a non-org-member this creates an
// org invitation scoped to the team; for a member it's immediate. Idempotent.
export async function addTeamMembership(
  org: string, teamSlug: string, username: string, token: string,
  fetcher: typeof fetch = fetch,
): Promise<{ state?: string }> {
  const res = await fetcher(
    `https://api.github.com/orgs/${org}/teams/${teamSlug}/memberships/${username}`,
    { method: "PUT", headers: ghHeaders(token), body: JSON.stringify({ role: "member" }) },
  );
  if (!res.ok) throw new Error(`team add failed: ${res.status}`);
  return (await res.json()) as { state?: string };
}

export async function removeTeamMembership(
  org: string, teamSlug: string, username: string, token: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const res = await fetcher(
    `https://api.github.com/orgs/${org}/teams/${teamSlug}/memberships/${username}`,
    { method: "DELETE", headers: ghHeaders(token) },
  );
  if (!res.ok && res.status !== 404) throw new Error(`team remove failed: ${res.status}`);
}

export async function removeOrgMember(
  org: string, username: string, token: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const res = await fetcher(`https://api.github.com/orgs/${org}/memberships/${username}`, {
    method: "DELETE", headers: ghHeaders(token),
  });
  if (!res.ok && res.status !== 404) throw new Error(`org remove failed: ${res.status}`);
}
