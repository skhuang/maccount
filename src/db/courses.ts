// Course-offerings (multi-tenant registry). One row per course per term, e.g.
// ds-2026. The top-level tenant key; maps to a Moodle course + a GitHub org.
// See migrations/0004_courses.sql.

export interface CourseRow {
  course_id: string;
  name: string;
  term: string | null;
  moodle_course_id: string | null;
  github_org: string | null;
  github_team_slug: string | null;
  github_repos: string | null;
  google_classroom_id: string | null;
  google_meet_url: string | null;
  google_group_email: string | null;
  status: string;
  created_at: string;
}

const COLS =
  "course_id, name, term, moodle_course_id, github_org, github_team_slug, github_repos, google_classroom_id, " +
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
  github_team_slug?: string | null;
  github_repos?: string | null;
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
         (course_id, name, term, moodle_course_id, github_org, github_team_slug, github_repos,
          google_classroom_id, google_meet_url, google_group_email, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(course_id) DO UPDATE SET
         name = ?2, term = ?3, moodle_course_id = ?4, github_org = ?5,
         github_team_slug = ?6, github_repos = ?7,
         google_classroom_id = ?8, google_meet_url = ?9, google_group_email = ?10,
         status = ?11`,
    )
    .bind(
      c.course_id, c.name, c.term ?? null, c.moodle_course_id ?? null,
      c.github_org ?? null, c.github_team_slug ?? null, c.github_repos ?? null,
      c.google_classroom_id ?? null, c.google_meet_url ?? null,
      c.google_group_email ?? null, c.status || "active", now,
    )
    .run();
}
