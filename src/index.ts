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
import { githubAuthorizeUrl, exchangeGithubCode, fetchGithubUser } from "./oauth/github";
import {
  upsertBinding,
  listBindings,
  deleteBinding,
  getBinding,
  GithubConflictError,
} from "./db/bindings";
import { upsertGrades, listGradesFor, GradeInput } from "./db/grades";
import { toCsv, toRosterCsv } from "./csv";
import { adminPage, studentPage } from "./html";

const TTL_MS = 15 * 60 * 1000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/auth/nycu/start") return await startNycu(req, env, url);
      if (p === "/auth/nycu/callback") return await nycuCallback(req, env, url);
      if (p === "/auth/github/callback") return await githubCallback(req, env, url);
      if (p === "/me" && req.method === "GET") return await mePage(req, env);
      if (p === "/api/grades/ingest" && req.method === "POST")
        return await gradesIngest(req, env);
      if (p === "/api/roster" && req.method === "GET") return await apiRoster(req, env);
      if (p === "/admin" && req.method === "GET") return await adminList(req, env);
      if (p === "/admin/export.csv") return await adminExport(req, env);
      if (p === "/admin/roster.csv") return await adminRoster(req, env);
      if (p === "/admin/delete" && req.method === "POST") return await adminDelete(req, env);
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

function redirect(location: string, cookie?: string): Response {
  const headers: Record<string, string> = { Location: location };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

function parsePurpose(url: URL): "admin" | "me" | "bind" {
  const p = url.searchParams.get("purpose");
  return p === "admin" ? "admin" : p === "me" ? "me" : "bind";
}

async function startNycu(req: Request, env: Env, url: URL): Promise<Response> {
  const purpose = parsePurpose(url);
  const nstate = randomState();
  const session: SessionData = { exp: Date.now() + TTL_MS, purpose, nstate };
  const token = await signSession(session, env.SESSION_SECRET);
  const redirectUri = `${env.PUBLIC_BASE_URL}/auth/nycu/callback`;
  return redirect(nycuAuthorizeUrl(nycuConfig(env), redirectUri, nstate), setCookie(token));
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

  if (session.purpose === "admin") {
    if (!isAdmin(env, user.id)) return new Response("Not authorized as admin", { status: 403 });
    const adminSession: SessionData = { exp: Date.now() + TTL_MS, admin: true, nycu: user };
    return redirect("/admin", setCookie(await signSession(adminSession, env.SESSION_SECRET)));
  }

  if (session.purpose === "me") {
    // Student logging in to view their own OJ status — no GitHub step needed.
    const meSession: SessionData = { exp: Date.now() + TTL_MS, student: true, nycu: user };
    return redirect("/me", setCookie(await signSession(meSession, env.SESSION_SECRET)));
  }

  const gstate = randomState();
  const next: SessionData = { exp: Date.now() + TTL_MS, purpose: "bind", nycu: user, gstate };
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
    if (e instanceof GithubConflictError) return redirectDone(env, "err", "github_already_bound");
    throw e;
  }
  return redirectDone(env, "ok");
}

// ── student status (/me) ────────────────────────────────────────────────
async function requireStudent(req: Request, env: Env): Promise<SessionData | Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  if (!session || !session.student || !session.nycu) {
    return redirect("/auth/nycu/start?purpose=me");
  }
  return session;
}

async function mePage(req: Request, env: Env): Promise<Response> {
  const s = await requireStudent(req, env);
  if (s instanceof Response) return s;
  const studentId = s.nycu!.id; // == 學號
  const [binding, grades] = await Promise.all([
    getBinding(env.DB, studentId),
    listGradesFor(env.DB, studentId),
  ]);
  return new Response(studentPage(s.nycu!, binding, grades), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
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

async function requireAdmin(req: Request, env: Env): Promise<SessionData | Response> {
  const session = await verifySession(readCookie(req), env.SESSION_SECRET, Date.now());
  if (!session || !session.admin || !session.nycu || !isAdmin(env, session.nycu.id)) {
    return redirect("/auth/nycu/start?purpose=admin");
  }
  return session;
}

async function adminList(req: Request, env: Env): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const rows = await listBindings(env.DB);
  return new Response(adminPage(rows), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function adminExport(req: Request, env: Env): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const rows = await listBindings(env.DB);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="bindings.csv"',
    },
  });
}

async function adminRoster(req: Request, env: Env): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const rows = await listBindings(env.DB);
  return new Response(toRosterCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="roster.csv"',
    },
  });
}

async function adminDelete(req: Request, env: Env): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const form = await req.formData();
  const nycuId = String(form.get("nycu_id") ?? "");
  if (nycuId) await deleteBinding(env.DB, nycuId);
  return redirect("/admin");
}
