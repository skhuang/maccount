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

// Resolve a Moodle numeric course id → course-offering (for the seminar-moodle
// enrollment sync, which knows the Moodle id, not our course_id). Newest first
// if (mis)configured to more than one.
export async function getCourseByMoodleId(
  db: D1Database, moodle_course_id: string,
): Promise<CourseRow | null> {
  return await db
    .prepare(`SELECT ${COLS} FROM courses WHERE moodle_course_id = ? ORDER BY created_at DESC`)
    .bind(moodle_course_id)
    .first<CourseRow>();
}

export interface CourseInput {
  course_id: string;
  name: string;
  term?: string | null;
  moodle_course_id?: string | null;
  github_org?: string | null;
  status?: string;
}

// Create or update a course-offering (owner only). created_at is set once on insert.
export async function upsertCourse(db: D1Database, c: CourseInput, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO courses (course_id, name, term, moodle_course_id, github_org, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(course_id) DO UPDATE SET
         name = ?2, term = ?3, moodle_course_id = ?4, github_org = ?5, status = ?6`,
    )
    .bind(
      c.course_id, c.name, c.term ?? null, c.moodle_course_id ?? null,
      c.github_org ?? null, c.status || "active", now,
    )
    .run();
}
