// Google Classroom API — invite a (bound) Google account to a course's
// Classroom as a student, acting as the logged-in staff member's connected
// Google account. The staff member must be a teacher of that Classroom, and the
// project must have the Classroom API enabled. courseId = the course's stored
// google_classroom_id (numeric id or alias).
export const CLASSROOM_SCOPE = "https://www.googleapis.com/auth/classroom.rosters";

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
