// Course-offerings (multi-tenant registry). One row per course per term, e.g.
// ds-2026. The top-level tenant key; maps to a Moodle course + a GitHub org.
// See migrations/0004_courses.sql.

export interface CourseRow {
  course_id: string;
  name: string;
  term: string | null;
  moodle_course_id: string | null;
  github_org: string | null;
  google_classroom_id: string | null;
  google_meet_url: string | null;
  google_group_email: string | null;
  status: string;
  created_at: string;
}

const COLS =
  "course_id, name, term, moodle_course_id, github_org, google_classroom_id, " +
  "google_meet_url, google_group_email, status, created_at";

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
  google_classroom_id?: string | null;
  google_meet_url?: string | null;
  google_group_email?: string | null;
  status?: string;
}

// Create or update a course-offering (owner only). created_at is set once on insert.
export async function upsertCourse(db: D1Database, c: CourseInput, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO courses
         (course_id, name, term, moodle_course_id, github_org, google_classroom_id,
          google_meet_url, google_group_email, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(course_id) DO UPDATE SET
         name = ?2, term = ?3, moodle_course_id = ?4, github_org = ?5,
         google_classroom_id = ?6, google_meet_url = ?7, google_group_email = ?8,
         status = ?9`,
    )
    .bind(
      c.course_id, c.name, c.term ?? null, c.moodle_course_id ?? null,
      c.github_org ?? null, c.google_classroom_id ?? null, c.google_meet_url ?? null,
      c.google_group_email ?? null, c.status || "active", now,
    )
    .run();
}
