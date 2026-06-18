// Course-offerings (multi-tenant registry). One row per course per term, e.g.
// ds-2026. The top-level tenant key; maps to a Moodle course + a GitHub org.
// See migrations/0004_courses.sql.

export interface CourseRow {
  course_id: string;
  name: string;
  term: string | null;
  moodle_course_id: string | null;
  github_org: string | null;
  status: string;
  created_at: string;
}

const COLS = "course_id, name, term, moodle_course_id, github_org, status, created_at";

export async function listCourses(db: D1Database): Promise<CourseRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM courses ORDER BY created_at DESC, course_id`)
    .all<CourseRow>();
  return results ?? [];
}

export async function getCourse(db: D1Database, course_id: string): Promise<CourseRow | null> {
  return await db
    .prepare(`SELECT ${COLS} FROM courses WHERE course_id = ?`)
    .bind(course_id)
    .first<CourseRow>();
}
