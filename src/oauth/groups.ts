export interface GoogleGroupMember {
  id?: string;
  email?: string;
  role?: "OWNER" | "MANAGER" | "MEMBER" | string;
  type?: "USER" | "GROUP" | string;
}

export interface GroupSyncResult {
  added: number;
  removed: number;
  kept: number;
  skippedProtected: number;
  errors: number;
}

interface MembersListResponse {
  members?: GoogleGroupMember[];
  nextPageToken?: string;
}

const GROUPS_BASE = "https://admin.googleapis.com/admin/directory/v1/groups";

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

function usableEmail(email: string): boolean {
  return !!email && email.includes("@");
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  return text.slice(0, 300);
}

export async function listGoogleGroupMembers(
  accessToken: string,
  groupEmail: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleGroupMember[]> {
  const members: GoogleGroupMember[] = [];
  let pageToken = "";
  do {
    const url = new URL(`${GROUPS_BASE}/${encodeURIComponent(groupEmail)}/members`);
    url.searchParams.set("maxResults", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetcher(url.toString(), { headers: authHeaders(accessToken) });
    if (!res.ok) throw new Error(`group members list failed: ${res.status} ${await errorText(res)}`);
    const data = (await res.json()) as MembersListResponse;
    members.push(...(data.members ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return members;
}

export async function addGoogleGroupMember(
  accessToken: string,
  groupEmail: string,
  email: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const res = await fetcher(`${GROUPS_BASE}/${encodeURIComponent(groupEmail)}/members`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, role: "MEMBER" }),
  });
  if (res.status === 409) return; // already a member; keep sync idempotent
  if (!res.ok) throw new Error(`group member add failed: ${res.status} ${await errorText(res)}`);
}

export async function removeGoogleGroupMember(
  accessToken: string,
  groupEmail: string,
  memberKey: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const res = await fetcher(
    `${GROUPS_BASE}/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(memberKey)}`,
    { method: "DELETE", headers: authHeaders(accessToken) },
  );
  if (res.status === 404) return; // already gone; keep sync idempotent
  if (!res.ok) throw new Error(`group member remove failed: ${res.status} ${await errorText(res)}`);
}

export async function syncGoogleGroupMembers(
  accessToken: string,
  groupEmail: string,
  targetEmails: Iterable<string>,
  fetcher: typeof fetch = fetch,
): Promise<GroupSyncResult> {
  const target = new Map<string, string>();
  for (const raw of targetEmails) {
    const email = raw.trim();
    const key = normalizeEmail(email);
    if (usableEmail(key) && !target.has(key)) target.set(key, email);
  }

  const existing = await listGoogleGroupMembers(accessToken, groupEmail, fetcher);
  const existingByEmail = new Map<string, GoogleGroupMember>();
  for (const member of existing) {
    const key = normalizeEmail(member.email ?? "");
    if (usableEmail(key)) existingByEmail.set(key, member);
  }

  let added = 0;
  let removed = 0;
  let kept = 0;
  let skippedProtected = 0;
  let errors = 0;

  for (const [key, email] of target) {
    if (existingByEmail.has(key)) {
      kept++;
      continue;
    }
    try {
      await addGoogleGroupMember(accessToken, groupEmail, email, fetcher);
      added++;
    } catch (e) {
      errors++;
      console.error(`group add failed for ${email}:`, (e as Error).message);
    }
  }

  for (const [key, member] of existingByEmail) {
    if (target.has(key)) continue;
    const isPlainMember = (member.role ?? "MEMBER") === "MEMBER" && (member.type ?? "USER") !== "GROUP";
    if (!isPlainMember) {
      skippedProtected++;
      continue;
    }
    const memberKey = member.id || member.email || key;
    try {
      await removeGoogleGroupMember(accessToken, groupEmail, memberKey, fetcher);
      removed++;
    } catch (e) {
      errors++;
      console.error(`group remove failed for ${member.email ?? memberKey}:`, (e as Error).message);
    }
  }

  return { added, removed, kept, skippedProtected, errors };
}
