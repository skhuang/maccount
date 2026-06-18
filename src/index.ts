import { Env, isAdmin, nycuConfig } from "./env";
import {
  SessionData,
  signSession,
  verifySession,
  setCookie,
  clearCookie,
  readCookie,
} from "./session";
import { randomState } from "./util";
import { nycuAuthorizeUrl, exchangeNycuCode, fetchNycuUser } from "./oauth/nycu";
import {
  githubAuthorizeUrl, exchangeGithubCode, fetchGithubUser, inviteOrgMember,
  addTeamMembership, removeTeamMembership, removeOrgMember,
  listOrgMembers, listPendingOrgInvites,
} from "./oauth/github";
import {
  upsertBinding,
  listBindings,
  deleteBinding,
  getBinding,
  orgBindingView,
  GithubConflictError,
} from "./db/bindings";
import { upsertGrades, listGradesFor, listGradesForProblem, GradeInput } from "./db/grades";
import {
  listStaff, addStaff, removeStaff, isStaffAnywhere, isStaffMember, coursesForStaff,
} from "./db/staff";
import { listCourses, getCourse, getCourseByMoodleId, upsertCourse } from "./db/courses";
import {
  bulkEnroll, replaceEnrollments, enrollmentCount, listEnrolledWithBinding, listEnrollments,
  coursesForStudent,
} from "./db/enrollments";
import { toCsv, toRosterCsv } from "./csv";
import { adminPage, adminHomePage, bindingsPage, orgMembersPage, dashboardPage } from "./html";
import { pickLang, langCookie } from "./i18n";

const TTL_MS = 15 * 60 * 1000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/auth/nycu/start") return await startNycu(req, env, url);
      if (p === "/auth/nycu/callback") return await nycuCallback(req, env, url);
      if (p === "/auth/github/start") return await startGithub(req, env);
      if (p === "/auth/github/callback") return await githubCallback(req, env, url);
      if (p === "/logout") return logout(env);
      if (p === "/me" && req.method === "GET") return await mePage(req, env, url);
      if (p === "/api/grades/ingest" && req.method === "POST")
        return await gradesIngest(req, env);
      if (p === "/api/roster" && req.method === "GET") return await apiRoster(req, env);
      if (p === "/api/grades" && req.method === "GET") return await apiGrades(req, env, url);
      if (p === "/api/enrollments/ingest" && req.method === "POST")
        return await enrollmentsIngest(req, env);
      if (p === "/admin" && req.method === "GET") return await adminHome(req, env, url);
      if (p === "/admin/bindings" && req.method === "GET") return await adminBindings(req, env, url);
      if (p === "/admin/courses" && req.method === "POST") return await courseUpsert(req, env);
      const om = p.match(/^\/admin\/org\/([A-Za-z0-9_.-]+)$/);
      if (om && req.method === "GET") return await adminOrgView(req, env, url, om[1]);
      const cm = p.match(/^\/c\/([A-Za-z0-9_-]+)\/admin(\/[A-Za-z0-9._/-]*)?$/);
      if (cm) return await courseAdminRouter(req, env, url, cm[1], cm[2] ?? "");
      return new Response("Not found", { status: 404 });
    } catch (e) {
      // Log detail server-side; return a generic message so upstream status codes
      // and raw D1 errors don't leak to clients. Clear any in-flight session cookie.
      console.error("maccount error:", (e as Error).message);
      return new Response("Internal error", {
        status: 500,
        headers: { "Set-Cookie": clearCookie() },
      });
    }
  },
};

function redirect(location: string, cookie?: string | string[]): Response {
  const headers = new Headers({ Location: location });
  if (cookie) for (const c of Array.isArray(cookie) ? cookie : [cookie]) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

// Single entry point: log in with NYCU. The landing dashboard (/me) is where a
// user then binds GitHub, sees grades, or (if admin) reaches admin functions.
async function startNycu(req: Request, env: Env, url: URL): Promise<Response> {
  const nstate = randomState();
  const session: SessionData = { exp: Date.now() + TTL_MS, nstate };
  const token = await signSession(session, env.SESSION_SECRET);
  const redirectUri = `${env.PUBLIC_BASE_URL}/auth/nycu/callback`;
  // Carry a language choice from the static landing page through the OAuth flow.
  const cookies = [setCookie(token)];
  const lang = url.searchParams.get("lang");
  if (lang === "en" || lang === "zh") cookies.push(langCookie(lang));
  const forceLogin = url.searchParams.get("prompt") === "login"; // logout→switch
  return redirect(nycuAuthorizeUrl(nycuConfig(env), redirectUri, nstate, forceLogin), cookies);
}

async function nycuCallback(req: Request, env: Env, url: URL): Promise<Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // NYCU returned an OAuth error (e.g. invalid_scope, access_denied) instead of a code.
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirectDone(env, "err", `nycu_${oauthError}`);
  if (!session || !session.nstate || session.nstate !== state || !code) {
    return new Response("Invalid NYCU callback", { status: 400 });
  }
  const cfg = nycuConfig(env);
  const redirectUri = `${env.PUBLIC_BASE_URL}/auth/nycu/callback`;
  const accessToken = await exchangeNycuCode(cfg, code, redirectUri);
  const user = await fetchNycuUser(cfg, accessToken);

  // Logged in. Admin-ness is derived from ADMIN_IDS at each admin request — no
  // separate login. Land everyone on the dashboard.
  const loggedIn: SessionData = { exp: Date.now() + TTL_MS, nycu: user };
  return redirect("/me", setCookie(await signSession(loggedIn, env.SESSION_SECRET)));
}

// Bind GitHub, started from the logged-in dashboard (not chained off NYCU login).
async function startGithub(req: Request, env: Env): Promise<Response> {
  const s = await requireLogin(req, env);
  if (s instanceof Response) return s;
  const gstate = randomState();
  const next: SessionData = { exp: Date.now() + TTL_MS, nycu: s.nycu, gstate };
  const token = await signSession(next, env.SESSION_SECRET);
  const ghUrl = githubAuthorizeUrl(
    env.GITHUB_CLIENT_ID,
    `${env.PUBLIC_BASE_URL}/auth/github/callback`,
    gstate,
  );
  return redirect(ghUrl, setCookie(token));
}

function redirectDone(env: Env, status: string, reason?: string): Response {
  const u = new URL(env.FRONTEND_DONE_URL);
  u.searchParams.set("status", status);
  if (reason) u.searchParams.set("reason", reason);
  return redirect(u.toString(), clearCookie());
}

async function githubCallback(req: Request, env: Env, url: URL): Promise<Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // GitHub returned an OAuth error (e.g. access_denied) instead of a code.
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirectDone(env, "err", `github_${oauthError}`);
  if (!session || !session.nycu || !session.gstate || session.gstate !== state || !code) {
    return new Response("Invalid GitHub callback", { status: 400 });
  }
  const accessToken = await exchangeGithubCode({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    code,
    redirectUri: `${env.PUBLIC_BASE_URL}/auth/github/callback`,
  });
  const gh = await fetchGithubUser(accessToken);
  const now = new Date(Date.now()).toISOString();
  try {
    await upsertBinding(env.DB, {
      nycu_id: session.nycu.id,
      nycu_name: session.nycu.name,
      github_id: gh.id,
      github_login: gh.login,
      now,
    });
  } catch (e) {
    if (e instanceof GithubConflictError) return redirect("/me?error=github_already_bound");
    throw e;
  }
  // Best-effort: invite the student to the GitHub org(s) of the courses they're
  // enrolled in (deduped effective orgs; falls back to the shared COURSE_ORG when
  // not yet enrolled), so the /me "join org" link is immediately actionable. A
  // failure must NOT affect the binding (dsjudge invite_org backfills any miss).
  if (env.ORG_INVITE_TOKEN) {
    for (const org of await studentOrgs(env, session.nycu.id)) {
      try {
        const m = await inviteOrgMember(org, gh.login, env.ORG_INVITE_TOKEN);
        console.log(`org invite: ${gh.login} -> ${m.state ?? "?"} (${org})`);
      } catch (e) {
        console.error(`org invite failed (${org}):`, (e as Error).message);
      }
    }
  }
  // Stay logged in; back to the dashboard with a success flash.
  return redirect("/me?bound=1");
}

// Clear the maccount session and bounce to the landing page so the user can log
// in as a different account. (NYCU/GitHub SSO may still auto-reuse their own
// session — switching those needs their logout / an incognito window.)
function logout(_env: Env): Response {
  // Clear the maccount session AND start a fresh NYCU login that forces a
  // re-prompt (prompt=login) — otherwise NYCU's SSO would silently log the same
  // user straight back in, defeating "switch account". (GitHub-account switching
  // still needs an incognito window; GitHub OAuth has no reliable re-prompt.)
  return redirect("/auth/nycu/start?prompt=login", clearCookie());
}

// A course's effective GitHub org: its own github_org, else the shared
// COURSE_ORG (model A + per-course override — see github-org-model).
function effectiveOrg(env: Env, course: { github_org?: string | null }): string {
  return (course.github_org ?? "").trim() || env.COURSE_ORG;
}

// The deduped GitHub orgs a student must belong to: the effective org of each
// course they're enrolled in. Falls back to the shared COURSE_ORG when the
// student has no enrollment yet (pre-Phase-3 sync), so the join link still shows.
async function studentOrgs(env: Env, studentId: string): Promise<string[]> {
  const ids = new Set(await coursesForStudent(env.DB, studentId));
  const orgs = new Set<string>();
  if (ids.size) {
    for (const c of await listCourses(env.DB)) {
      if (ids.has(c.course_id)) {
        const o = effectiveOrg(env, c);
        if (o) orgs.add(o);
      }
    }
  }
  if (orgs.size === 0 && env.COURSE_ORG) orgs.add(env.COURSE_ORG);
  return [...orgs];
}

// ── dashboard (/me) ───────────────────────────────────────────────────────
async function requireLogin(req: Request, env: Env): Promise<SessionData | Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  if (!session || !session.nycu) return redirect("/auth/nycu/start");
  return session;
}

async function mePage(req: Request, env: Env, url: URL): Promise<Response> {
  const s = await requireLogin(req, env);
  if (s instanceof Response) return s;
  const studentId = s.nycu!.id; // == 學號
  const lang = pickLang(url, req.headers.get("Cookie"));
  const [binding, grades, courses] = await Promise.all([
    getBinding(env.DB, studentId),
    listGradesFor(env.DB, studentId),
    listCourses(env.DB),
  ]);
  const courseNames: Record<string, string> = {};
  for (const c of courses) courseNames[c.course_id] = c.name;
  const flash = {
    bound: url.searchParams.get("bound") === "1",
    error: url.searchParams.get("error"),
  };
  // Join link(s) for the org(s) of the student's enrolled courses (deduped;
  // falls back to the shared COURSE_ORG when not yet enrolled).
  const orgJoins = (await studentOrgs(env, studentId)).map((org) => ({
    org,
    url: `https://github.com/orgs/${org}/invitation`,
  }));
  // Show the admin link to owners AND staff-table members (of any course).
  const staff = isAdmin(env, studentId) || (await isStaffAnywhere(env.DB, studentId));
  const html = dashboardPage(lang, s.nycu!, binding, grades, staff, flash, orgJoins, courseNames);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": langCookie(lang) },
  });
}

// ── grades ingest (trusted OJ runner → D1) ────────────────────────────────
// Constant-time token compare (length leak on a random token is acceptable).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Shared-secret check for the trusted OJ runner (ingest push + roster pull).
function bearerOk(req: Request, env: Env): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return !!env.GRADES_INGEST_TOKEN && safeEqual(token, env.GRADES_INGEST_TOKEN);
}

// Machine-readable roster pull (github_login,student_id) for the OJ host's
// roster-sync timer — token-auth (no NYCU session), unlike /admin/roster.csv.
async function apiRoster(req: Request, env: Env): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Unauthorized", { status: 401 });
  const rows = await listBindings(env.DB);
  return new Response(toRosterCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8" },
  });
}

// Grades for one problem (token-auth) — the OJ→Moodle "程式作業自動批改" pulls
// this and fills the Moodle grader. score+verdict only (iron rule 2).
async function apiGrades(req: Request, env: Env, url: URL): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Unauthorized", { status: 401 });
  const problemId = url.searchParams.get("problem_id");
  if (!problemId) return new Response("problem_id required", { status: 400 });
  const grades = await listGradesForProblem(env.DB, problemId);
  return new Response(JSON.stringify({ ok: true, grades }), {
    headers: { "Content-Type": "application/json" },
  });
}

const MAX_INGEST_ROWS = 10000;

async function gradesIngest(req: Request, env: Env): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as unknown;
  const arr = Array.isArray(body)
    ? body
    : body && Array.isArray((body as { grades?: unknown[] }).grades)
      ? (body as { grades: unknown[] }).grades
      : null;
  if (!arr) return new Response("Bad request", { status: 400 });
  if (arr.length > MAX_INGEST_ROWS) {
    return new Response("Too many rows", { status: 413 });
  }

  const rows: GradeInput[] = [];
  for (const x of arr as Record<string, unknown>[]) {
    if (!x || typeof x.student_id !== "string" || typeof x.problem_id !== "string") continue;
    if (!x.student_id || !x.problem_id) continue;
    rows.push({
      // Course-offering tag; dsjudge sends it from Phase 2. Until then, rows
      // without one fall back to the default course (back-compat).
      course_id: (typeof x.course_id === "string" && x.course_id) || defaultCourse(env),
      student_id: x.student_id,
      problem_id: x.problem_id,
      // score + verdict ONLY — any other fields in the payload are ignored.
      verdict: String(x.verdict ?? ""),
      score: Number(x.score ?? 0),
      max_score: Number(x.max_score ?? 0),
      updated_at: String(x.updated_at ?? new Date(Date.now()).toISOString()),
    });
  }
  const upserted = await upsertGrades(env.DB, rows);
  return new Response(JSON.stringify({ ok: true, upserted }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Owner = a bootstrap admin in ADMIN_IDS (manages staff + destructive ops).
async function requireAdmin(req: Request, env: Env): Promise<SessionData | Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  if (!session || !session.nycu) return redirect("/auth/nycu/start");
  if (!isAdmin(env, session.nycu.id)) {
    return new Response("Not authorized as admin", { status: 403 });
  }
  return session;
}

// Staff = an owner OR a member of the D1 staff table. May view /admin + export.
async function requireStaff(req: Request, env: Env): Promise<SessionData | Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  if (!session || !session.nycu) return redirect("/auth/nycu/start");
  if (!isAdmin(env, session.nycu.id) && !(await isStaffAnywhere(env.DB, session.nycu.id))) {
    return new Response("Not authorized", { status: 403 });
  }
  return session;
}

// Staff of a SPECIFIC course (owner is staff of every course). Gates the
// course-scoped admin views + exports.
async function requireCourseStaff(
  req: Request, env: Env, courseId: string,
): Promise<SessionData | Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  if (!session || !session.nycu) return redirect("/auth/nycu/start");
  if (!isAdmin(env, session.nycu.id) && !(await isStaffMember(env.DB, courseId, session.nycu.id))) {
    return new Response("Not authorized", { status: 403 });
  }
  return session;
}

// /admin — course picker. Owners see all courses + a create form; staff see
// only their courses.
// Distinct GitHub orgs across all courses (each course's effective org) + the
// shared COURSE_ORG — the set offered for the "query bindings by org" view.
async function effectiveOrgs(env: Env): Promise<string[]> {
  const orgs = new Set<string>();
  if (env.COURSE_ORG) orgs.add(env.COURSE_ORG);
  for (const c of await listCourses(env.DB)) {
    const o = effectiveOrg(env, c);
    if (o) orgs.add(o);
  }
  return [...orgs];
}

async function adminHome(req: Request, env: Env, url: URL): Promise<Response> {
  const s = await requireStaff(req, env);
  if (s instanceof Response) return s;
  const isOwner = isAdmin(env, s.nycu!.id);
  const lang = pickLang(url, req.headers.get("Cookie"));
  let courses = await listCourses(env.DB);
  if (!isOwner) {
    const mine = new Set(await coursesForStaff(env.DB, s.nycu!.id));
    courses = courses.filter((c) => mine.has(c.course_id));
  }
  const orgs = await effectiveOrgs(env);
  return new Response(adminHomePage(lang, courses, { isOwner, orgs }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": langCookie(lang) },
  });
}

// GET /admin/bindings — the global binding registry (all bound students),
// independent of course/enrollment. The pre-enrollment catch-all.
async function adminBindings(req: Request, env: Env, url: URL): Promise<Response> {
  const s = await requireStaff(req, env);
  if (s instanceof Response) return s;
  const lang = pickLang(url, req.headers.get("Cookie"));
  const [rows, orgs] = await Promise.all([listBindings(env.DB), effectiveOrgs(env)]);
  return new Response(bindingsPage(lang, rows, orgs), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": langCookie(lang) },
  });
}

// GET /admin/org/<org> — query bindings by GitHub org: live-fetch the org's
// members + pending invites (once each) and join to the binding registry.
async function adminOrgView(req: Request, env: Env, url: URL, org: string): Promise<Response> {
  const s = await requireStaff(req, env);
  if (s instanceof Response) return s;
  if (!(await effectiveOrgs(env)).includes(org)) return new Response("Unknown org", { status: 404 });
  if (!env.ORG_INVITE_TOKEN) return new Response("ORG_INVITE_TOKEN not set", { status: 400 });
  const lang = pickLang(url, req.headers.get("Cookie"));
  let members: string[] = [];
  let pending: string[] = [];
  let err = "";
  try {
    [members, pending] = await Promise.all([
      listOrgMembers(org, env.ORG_INVITE_TOKEN),
      listPendingOrgInvites(org, env.ORG_INVITE_TOKEN),
    ]);
  } catch (e) {
    err = (e as Error).message;
  }
  const view = orgBindingView(await listBindings(env.DB), members, pending);
  return new Response(orgMembersPage(lang, org, view, err), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": langCookie(lang) },
  });
}

// POST /admin/courses — owner creates/updates a course-offering.
async function courseUpsert(req: Request, env: Env): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const form = await req.formData();
  const course_id = String(form.get("course_id") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  if (!course_id || !/^[A-Za-z0-9_-]+$/.test(course_id) || !name) return redirect("/admin");
  const statusIn = String(form.get("status") ?? "").trim();
  await upsertCourse(
    env.DB,
    {
      course_id,
      name,
      term: String(form.get("term") ?? "").trim() || null,
      moodle_course_id: String(form.get("moodle_course_id") ?? "").trim() || null,
      github_org: String(form.get("github_org") ?? "").trim() || null,
      status: statusIn === "archived" ? "archived" : "active",
    },
    new Date(Date.now()).toISOString(),
  );
  // Edits come from the course page; new courses from the picker. Return to
  // wherever makes sense: the course page if it now exists.
  return redirect(`/c/${encodeURIComponent(course_id)}/admin`);
}

// /c/<course_id>/admin[/...] dispatch.
async function courseAdminRouter(
  req: Request, env: Env, url: URL, courseId: string, sub: string,
): Promise<Response> {
  const m = req.method;
  if (sub === "" && m === "GET") return await courseAdmin(req, env, url, courseId);
  if (sub === "/export.csv" && m === "GET") return await courseExport(req, env, courseId);
  if (sub === "/roster.csv" && m === "GET") return await courseRoster(req, env, courseId);
  if (sub === "/delete" && m === "POST") return await courseDelete(req, env, courseId);
  if (sub === "/staff/add" && m === "POST") return await staffAdd(req, env, courseId);
  if (sub === "/staff/remove" && m === "POST") return await staffRemove(req, env, courseId);
  if (sub === "/enroll" && m === "POST") return await courseEnroll(req, env, courseId);
  return new Response("Not found", { status: 404 });
}

async function courseAdmin(req: Request, env: Env, url: URL, courseId: string): Promise<Response> {
  const s = await requireCourseStaff(req, env, courseId);
  if (s instanceof Response) return s;
  const course = await getCourse(env.DB, courseId);
  if (!course) return new Response("Course not found", { status: 404 });
  const isOwner = isAdmin(env, s.nycu!.id);
  const lang = pickLang(url, req.headers.get("Cookie"));
  const [rows, staff, enrolled] = await Promise.all([
    listBindings(env.DB),
    listStaff(env.DB, courseId),
    listEnrolledWithBinding(env.DB, courseId),
  ]);
  // Once a course has an enrolled roster, the bindings table scopes to it
  // (enrolled ∩ bound); before that it shows the global registry (back-compat).
  const scoped = enrolled.length ? rows.filter((r) => enrolled.some((e) => e.student_id === r.nycu_id)) : rows;
  const staffMsg = url.searchParams.get("staff_msg") ?? "";
  return new Response(
    adminPage(lang, course, scoped, { isOwner, staff, staffMsg, enrolled }),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": langCookie(lang) } },
  );
}

// Enrolled student_ids for a course, or null if the course has no roster yet
// (callers then fall back to the global binding list — back-compat).
async function enrolledSet(env: Env, courseId: string): Promise<Set<string> | null> {
  const rows = await listEnrollments(env.DB, courseId);
  return rows.length ? new Set(rows.map((r) => r.student_id)) : null;
}

// Per-course bindings CSV. Scoped to the enrolled roster once one exists.
async function courseExport(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireCourseStaff(req, env, courseId);
  if (s instanceof Response) return s;
  const set = await enrolledSet(env, courseId);
  let rows = await listBindings(env.DB);
  if (set) rows = rows.filter((r) => set.has(r.nycu_id));
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bindings-${courseId}.csv"`,
    },
  });
}

// Per-course roster.csv (github_login,student_id). Scoped to enrolled ∩ bound.
async function courseRoster(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireCourseStaff(req, env, courseId);
  if (s instanceof Response) return s;
  const set = await enrolledSet(env, courseId);
  let rows = await listBindings(env.DB);
  if (set) rows = rows.filter((r) => set.has(r.nycu_id));
  return new Response(toRosterCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="roster-${courseId}.csv"`,
    },
  });
}

// POST /c/<id>/admin/enroll — owner imports a roster (paste). `replace` swaps
// the whole roster (Moodle-authoritative); otherwise it's additive.
async function courseEnroll(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  if (!(await getCourse(env.DB, courseId))) return new Response("Course not found", { status: 404 });
  const form = await req.formData();
  const ids = parseStudentIds(String(form.get("student_ids") ?? ""));
  const replace = form.get("replace") != null;
  const now = new Date(Date.now()).toISOString();
  if (replace) await replaceEnrollments(env.DB, courseId, ids, now);
  else await bulkEnroll(env.DB, courseId, ids, now);
  return redirect(`/c/${encodeURIComponent(courseId)}/admin`);
}

// Split a pasted blob of 學號 on commas / whitespace / newlines.
function parseStudentIds(blob: string): string[] {
  return blob.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

// POST /api/enrollments/ingest — token-auth roster import for automation
// (e.g. seminar-moodle pushing Moodle participants). Body:
// { course_id | moodle_course_id, student_ids: [...], replace?: bool }.
// moodle_course_id is resolved to a course_id via courses.moodle_course_id, so
// the caller can send the Moodle numeric id it already has.
async function enrollmentsIngest(req: Request, env: Env): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { course_id?: unknown; moodle_course_id?: unknown; student_ids?: unknown; replace?: unknown }
    | null;
  const list = Array.isArray(body?.student_ids) ? body!.student_ids : null;
  if (!list) return new Response("Bad request", { status: 400 });
  let course_id = typeof body?.course_id === "string" ? body.course_id : "";
  const moodleId = body?.moodle_course_id != null ? String(body.moodle_course_id) : "";
  if (!course_id && moodleId) {
    const c = await getCourseByMoodleId(env.DB, moodleId);
    if (!c) return new Response(`No course mapped to moodle_course_id ${moodleId}`, { status: 404 });
    course_id = c.course_id;
  }
  if (!course_id) return new Response("Bad request", { status: 400 });
  if (!(await getCourse(env.DB, course_id))) return new Response("Unknown course", { status: 404 });
  const ids = list.filter((x): x is string => typeof x === "string");
  if (ids.length > MAX_INGEST_ROWS) return new Response("Too many rows", { status: 413 });
  const now = new Date(Date.now()).toISOString();
  const n = body?.replace
    ? await replaceEnrollments(env.DB, course_id, ids, now)
    : await bulkEnroll(env.DB, course_id, ids, now);
  return new Response(JSON.stringify({ ok: true, course_id, enrolled: n }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function courseDelete(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireAdmin(req, env); // owner only — destructive
  if (s instanceof Response) return s;
  const form = await req.formData();
  const nycuId = String(form.get("nycu_id") ?? "");
  if (nycuId) await deleteBinding(env.DB, nycuId);
  return redirect(`/c/${encodeURIComponent(courseId)}/admin`);
}

// Fallback course for grade ingests that don't (yet) carry a course_id — dsjudge
// starts sending one in Phase 2. Admin routes are course-scoped (/c/<id>/) as
// of Phase 1b and no longer use this.
function defaultCourse(env: Env): string {
  return env.DEFAULT_COURSE_ID || "ds-2026";
}

// Sync a staff member to the GitHub org + staff team (scope: team+org).
// Best-effort, never throws. Returns a short status code for the /admin flash:
// "" (no GitHub sync configured), "ok", "no-binding" (TA hasn't bound GitHub),
// or "error". The staff DB row is the source of truth; GitHub is a side effect.
async function syncStaffToGitHub(env: Env, nycuId: string, add: boolean): Promise<string> {
  if (!(env.COURSE_ORG && env.ORG_INVITE_TOKEN && env.STAFF_TEAM)) return "";
  const b = await getBinding(env.DB, nycuId);
  const login = b?.github_login;
  if (!login) return "no-binding";
  const { COURSE_ORG: org, STAFF_TEAM: team, ORG_INVITE_TOKEN: tok } = env;
  try {
    if (add) {
      await inviteOrgMember(org, login, tok);          // org
      await addTeamMembership(org, team, login, tok);  // staff team
    } else {
      await removeTeamMembership(org, team, login, tok); // staff team
      await removeOrgMember(org, login, tok);            // org
    }
    return "ok";
  } catch (e) {
    console.error("staff github sync failed:", (e as Error).message);
    return "error";
  }
}

function adminRedirect(courseId: string, msg: string): Response {
  const base = `/c/${encodeURIComponent(courseId)}/admin`;
  return redirect(msg ? `${base}?staff_msg=${encodeURIComponent(msg)}` : base);
}

// Staff management — OWNER only (so a TA can't add/remove staff = no escalation).
async function staffAdd(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const form = await req.formData();
  const id = String(form.get("nycu_id") ?? "").trim();
  if (!id) return redirect(`/c/${encodeURIComponent(courseId)}/admin`);
  await addStaff(env.DB, courseId, id, s.nycu!.id, new Date(Date.now()).toISOString());
  return adminRedirect(courseId, await syncStaffToGitHub(env, id, true));
}

async function staffRemove(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const form = await req.formData();
  const id = String(form.get("nycu_id") ?? "").trim();
  if (!id) return redirect(`/c/${encodeURIComponent(courseId)}/admin`);
  await removeStaff(env.DB, courseId, id);
  return adminRedirect(courseId, await syncStaffToGitHub(env, id, false));
}
