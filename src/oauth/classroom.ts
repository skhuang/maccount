// Google Classroom API — invite a (bound) Google account to a course's
// Classroom as a student, acting as the logged-in staff member's connected
// Google account. The staff member must be a teacher of that Classroom, and the
// project must have the Classroom API enabled. courseId = the course's stored
// google_classroom_id (numeric id or alias).
export const CLASSROOM_SCOPE = "https://www.googleapis.com/auth/classroom.rosters";

// Normalize whatever a teacher pastes into the Classroom API's numeric course
// id. The Classroom *URL* is classroom.google.com/c/<token>, where <token> is
// base64(numericId) — the API rejects that token (404) and wants the digits.
// Accepts: the numeric id as-is, a `/c/<token>` (or full URL), or a bare token.
export function parseClassroomId(input: string): string {
  let s = input.trim();
  const m = s.match(/\/c\/([A-Za-z0-9_-]+)/); // full URL or /c/<token>
  if (m) s = m[1];
  if (/^\d+$/.test(s)) return s; // already the numeric API course id
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const decoded = atob(b64 + pad);
    if (/^\d+$/.test(decoded)) return decoded; // the /c/ token decodes to digits
  } catch {
    /* not base64 → leave as typed */
  }
  return s;
}

export type InviteResult = { invited: true } | { already: true };

export async function inviteToClassroom(
  accessToken: string,
  courseId: string,
  email: string,
  fetcher: typeof fetch = fetch,
): Promise<InviteResult> {
  const res = await fetcher("https://classroom.googleapis.com/v1/invitations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ courseId, userId: email, role: "STUDENT" }),
  });
  // 409 ALREADY_EXISTS = already invited or already a member → treat as success.
  if (res.status === 409) return { already: true };
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`classroom invite failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  return { invited: true };
}
