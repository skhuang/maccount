// Google Drive sharing, acting as the logged-in staff member (their own OAuth
// token). Used to grant enrolled+bound students access to a staff-owned file or
// folder by their bound Google email. Sharing a pre-existing Drive item needs
// the full `drive` scope, so staff "connect Drive" with STAFF_GOOGLE_SCOPE (the
// per-student bindings stay on the minimal scope — only their email is used).
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
// Also request the Forms scope so a freshly-connected staff token can create
// Google Forms via the Forms API. (Full `drive` alone already authorizes
// forms.create, so staff connected before this still work.)
export const FORMS_SCOPE = "https://www.googleapis.com/auth/forms.body";
// Manage a Classroom's roster (invite students). Re-connect picks it up; staff
// connected earlier re-authorize once to gain it.
export const CLASSROOM_SCOPE = "https://www.googleapis.com/auth/classroom.rosters";
// Manage course Google Group membership so Google Forms can grant responder
// access to one group instead of hundreds of individual accounts.
export const GROUP_MEMBER_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";
export const STAFF_GOOGLE_SCOPE = `openid email ${DRIVE_SCOPE} ${FORMS_SCOPE} ${CLASSROOM_SCOPE} ${GROUP_MEMBER_SCOPE}`;

export type DriveRole = "reader" | "commenter" | "writer";

export function asDriveRole(v: string): DriveRole {
  return v === "writer" ? "writer" : v === "commenter" ? "commenter" : "reader";
}

// True only if the granted scope string includes the FULL drive scope (not just
// drive.file) — i.e. the token can manage permissions on existing files.
export function scopeHasFullDrive(scope: string | null | undefined): boolean {
  return !!scope && scope.split(/\s+/).includes(DRIVE_SCOPE);
}

export function scopeHasGroupMember(scope: string | null | undefined): boolean {
  return !!scope && scope.split(/\s+/).includes(GROUP_MEMBER_SCOPE);
}

// Accept a raw Drive id or a pasted share URL and return the id. Handles the
// common forms: /d/<id> (Docs/Sheets/file), /folders/<id>, and ?id=<id>.
export function parseDriveFileId(input: string): string {
  const s = input.trim();
  const path = s.match(/\/(?:d|folders)\/([A-Za-z0-9_-]+)/);
  if (path) return path[1];
  const q = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (q) return q[1];
  return s;
}

// Grant `email` `role` permission on a Drive file/folder. supportsAllDrives so
// shared-drive items work too. Returns the new permission id. Throws on a
// non-2xx (caller counts per-recipient failures).
export async function shareFileWithUser(
  accessToken: string,
  fileId: string,
  email: string,
  role: DriveRole,
  opts: { notify?: boolean } = {},
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const u = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
  );
  u.searchParams.set("supportsAllDrives", "true");
  u.searchParams.set("sendNotificationEmail", opts.notify ? "true" : "false");
  u.searchParams.set("fields", "id");
  const res = await fetcher(u.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ role, type: "user", emailAddress: email }),
  });
  if (!res.ok) throw new Error(`drive share failed: ${res.status}`);
  const data = (await res.json()) as { id?: string };
  return data.id ?? "";
}
