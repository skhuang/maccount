// Google Forms attached to a course (see migrations/0011_course_forms.sql).
// We only store the link + a title; the form's own settings enforce Google
// sign-in. Students see them per-course on /me; staff manage them in /admin.

export interface CourseForm {
  id: number;
  course_id: string;
  title: string;
  url: string;
  form_id: string | null; // set when created via the Forms API → enables edit link
  pre_enroll: number;     // 1 = for not-yet-enrolled students (shown on /me/<course_id>)
  created_at: string;
}

const COLS = "id, course_id, title, url, form_id, pre_enroll, created_at";

export async function listCourseForms(db: D1Database, course_id: string): Promise<CourseForm[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM course_forms WHERE course_id = ? ORDER BY id`)
    .bind(course_id)
    .all<CourseForm>();
  return results ?? [];
}

// Forms for a set of courses in one query (for the /me course list). Empty input
// is a no-op (avoids an `IN ()` syntax error).
export async function listFormsForCourses(
  db: D1Database, course_ids: string[],
): Promise<CourseForm[]> {
  const ids = [...new Set(course_ids)];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM course_forms WHERE course_id IN (${placeholders}) ORDER BY course_id, id`)
    .bind(...ids)
    .all<CourseForm>();
  return results ?? [];
}

export async function addCourseForm(
  db: D1Database, course_id: string, title: string, url: string, now: string,
  form_id: string | null = null, pre_enroll = false,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO course_forms (course_id, title, url, form_id, pre_enroll, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(course_id, title, url, form_id, pre_enroll ? 1 : 0, now)
    .run();
}

// Delete by id, scoped to its course so a staff member of one course can't
// remove another course's form by guessing an id.
export async function removeCourseForm(
  db: D1Database, id: number, course_id: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM course_forms WHERE id = ? AND course_id = ?")
    .bind(id, course_id)
    .run();
}
