import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { signSession, SESSION_COOKIE } from "../src/session";
import { listBindings } from "../src/db/bindings";
import type { Env } from "../src/env";

const SECRET = "test-secret";

const testEnv: Env = {
  DB: env.DB,
  SESSION_SECRET: SECRET,
  PUBLIC_BASE_URL: "https://api.example",
  FRONTEND_DONE_URL: "https://skhuang.github.io/maccount/done.html",
  ADMIN_IDS: "admin1",
  GITHUB_CLIENT_ID: "gh_id",
  GITHUB_CLIENT_SECRET: "gh_secret",
  NYCU_AUTHORIZE_URL: "https://id.nycu.edu.tw/o/authorize/",
  NYCU_TOKEN_URL: "https://id.nycu.edu.tw/o/token/",
  NYCU_USERINFO_URL: "https://id.nycu.edu.tw/o/userinfo/",
  NYCU_SCOPE: "openid profile",
  NYCU_CLIENT_ID: "n_id",
  NYCU_CLIENT_SECRET: "n_secret",
  GRADES_INGEST_TOKEN: "ingest-secret",
  COURSE_ORG: "nycu-cs-course-ds",
  ORG_INVITE_TOKEN: "org-tok",
  STAFF_TEAM: "", // sync off by default; sync tests override with "staff"
  DEFAULT_COURSE_ID: "ds-2026",
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM bindings").run();
  await env.DB.prepare("DELETE FROM grades").run();
  await env.DB.prepare("DELETE FROM staff").run();
  await env.DB.prepare("DELETE FROM enrollments").run();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function cookie(token: string): HeadersInit {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}
function call(path: string, init?: RequestInit, e: Env = testEnv) {
  return worker.fetch(new Request(`https://api.example${path}`, init), e);
}

describe("/auth/nycu/start", () => {
  it("redirects to NYCU and sets a session cookie", async () => {
    const res = await call("/auth/nycu/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("id.nycu.edu.tw/o/authorize/");
    expect(res.headers.get("Set-Cookie")).toContain(SESSION_COOKIE);
  });
});

describe("/auth/nycu/callback (login → dashboard)", () => {
  it("sets a logged-in session and redirects to /me", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("token"))
          return new Response(JSON.stringify({ access_token: "n_tok" }), {
            headers: { "Content-Type": "application/json" },
          });
        return new Response(JSON.stringify({ username: "AT9336", name: "師" }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const session = await signSession({ exp: Date.now() + 60000, nstate: "NS" }, SECRET);
    const res = await call("/auth/nycu/callback?code=abc&state=NS", { headers: cookie(session) });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/me");
    expect(res.headers.get("Set-Cookie")).toContain(SESSION_COOKIE);
  });
});

describe("OAuth provider error on callback", () => {
  it("surfaces a NYCU error to the done page", async () => {
    const res = await call("/auth/nycu/callback?error=invalid_scope&state=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=err&reason=nycu_invalid_scope",
    );
  });

  it("surfaces a GitHub error to the done page", async () => {
    const res = await call("/auth/github/callback?error=access_denied&state=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=err&reason=github_access_denied",
    );
  });
});

describe("/auth/github/callback (bind happy path)", () => {
  it("upserts a binding and redirects to /me?bound=1", async () => {
    const orgInvited: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("login/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "gh_tok" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("api.github.com/user")) {
          return new Response(JSON.stringify({ id: 999, login: "octo" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/memberships/")) { // auto org-invite after bind
          orgInvited.push(url);
          return new Response(JSON.stringify({ state: "pending" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error("unexpected fetch " + url);
      }),
    );
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王小明" }, gstate: "GS" },
      SECRET,
    );
    const res = await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/me?bound=1");
    const rows = await listBindings(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nycu_id: "0856001", github_id: 999, github_login: "octo" });
    // auto-invited octo to the org
    expect(orgInvited.some((u) => u.includes("/orgs/nycu-cs-course-ds/memberships/octo"))).toBe(true);
  });

  it("binding still succeeds if the org invite fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("access_token"))
        return new Response(JSON.stringify({ access_token: "t" }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/memberships/")) return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({ id: 888, login: "mona" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856002", name: "李" }, gstate: "GS" },
      SECRET,
    );
    const res = await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe("/me?bound=1"); // invite failure ignored
    expect((await listBindings(env.DB)).some((r) => r.github_login === "mona")).toBe(true);
  });

  it("invites the binder to the effective org of their enrolled course", async () => {
    await env.DB.prepare(
      "INSERT INTO courses (course_id, name, github_org, status, created_at) VALUES ('swtest-2026','軟測','swtest-org','active','t')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('swtest-2026','0856003','student','t')",
    ).run();
    const invited: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("access_token"))
        return new Response(JSON.stringify({ access_token: "t" }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/memberships/")) { invited.push(url); return new Response("{}", { headers: { "Content-Type": "application/json" } }); }
      return new Response(JSON.stringify({ id: 777, login: "neo" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856003", name: "尼" }, gstate: "GS" }, SECRET);
    await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(invited.some((u) => u.includes("/orgs/swtest-org/memberships/neo"))).toBe(true);
    expect(invited.some((u) => u.includes("/orgs/nycu-cs-course-ds/"))).toBe(false); // only the enrolled course's org
    await env.DB.prepare("DELETE FROM courses WHERE course_id='swtest-2026'").run();
  });

  it("redirects with status=err when github already bound to another nycu", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('other','x',999,'octo','t','t')",
    ).run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("access_token"))
          return new Response(JSON.stringify({ access_token: "t" }), { headers: { "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ id: 999, login: "octo" }), { headers: { "Content-Type": "application/json" } });
      }),
    );
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王" }, gstate: "GS" },
      SECRET,
    );
    const res = await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe("/me?error=github_already_bound");
  });

  it("rejects a state mismatch", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "x", name: "x" }, gstate: "GS" },
      SECRET,
    );
    const res = await call("/auth/github/callback?code=abc&state=WRONG", { headers: cookie(session) });
    expect(res.status).toBe(400);
  });
});

describe("/admin auth gate", () => {
  it("redirects anonymous users to NYCU login", async () => {
    const res = await call("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });

  it("serves the course picker to an admin session", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/admin", { headers: cookie(session) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('href="/c/ds-2026/admin"'); // seeded course
    expect(body).toContain('action="/admin/courses"'); // owner create form
  });

  it("exports a course's CSV to an admin session", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/c/ds-2026/admin/export.csv", { headers: cookie(session) });
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("bindings-ds-2026.csv");
    expect(await res.text()).toContain("nycu_id,nycu_name");
  });

  it("denies CSV export to an anonymous request", async () => {
    const res = await call("/c/ds-2026/admin/export.csv");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });

  it("forbids CSV export to a logged-in non-staff (403)", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王" } },
      SECRET,
    );
    const res = await call("/c/ds-2026/admin/export.csv", { headers: cookie(session) });
    expect(res.status).toBe(403);
  });

  it("denies delete to an anonymous request and does not mutate", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('0856001','王',1,'octo','t','t')",
    ).run();
    const body = new URLSearchParams({ nycu_id: "0856001" });
    const res = await call("/c/ds-2026/admin/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
    expect(await listBindings(env.DB)).toHaveLength(1);
  });
});

describe("staff/TA management", () => {
  const staffSession = () =>
    signSession({ exp: Date.now() + 60000, nycu: { id: "ta01", name: "助教" } }, SECRET);

  it("a staff member sees /admin as a picker listing only their course", async () => {
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const res = await call("/admin", { headers: cookie(await staffSession()) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('href="/c/ds-2026/admin"'); // link into their course
    expect(body).not.toContain('action="/admin/courses"'); // owner-only create form
  });

  it("a staff member can view their course admin read-only (no delete / no manage-staff)", async () => {
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const res = await call("/c/ds-2026/admin", { headers: cookie(await staffSession()) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("綁定名單");
    expect(body).not.toContain('action="/c/ds-2026/admin/delete"');     // owner-only
    expect(body).not.toContain('action="/c/ds-2026/admin/staff/add"');  // owner-only
  });

  it("a TA of a different course is denied this course's admin (403)", async () => {
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2027','ta01','admin1','t')").run();
    const res = await call("/c/ds-2026/admin", { headers: cookie(await staffSession()) });
    expect(res.status).toBe(403);
  });

  it("a logged-in non-staff non-owner is denied /admin (403)", async () => {
    const res = await call("/admin", { headers: cookie(await staffSession()) }); // ta01 not yet staff
    expect(res.status).toBe(403);
  });

  it("owner can add a staff member to a course", async () => {
    const owner = await signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
    const res = await call("/c/ds-2026/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(owner), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    });
    expect(res.status).toBe(302);
    const row = await env.DB.prepare("SELECT course_id FROM staff WHERE nycu_id='ta01'").first<{ course_id: string }>();
    expect(row?.course_id).toBe("ds-2026"); // written under the path's course
  });

  it("owner can create a course (POST /admin/courses)", async () => {
    const owner = await signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
    const res = await call("/admin/courses", {
      method: "POST",
      headers: { ...cookie(owner), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ course_id: "swtest-2026", name: "軟體測試 2026", moodle_course_id: "12345" }).toString(),
    });
    expect(res.status).toBe(302);
    const row = await env.DB.prepare("SELECT name, moodle_course_id FROM courses WHERE course_id='swtest-2026'").first();
    expect(row).toMatchObject({ name: "軟體測試 2026", moodle_course_id: "12345" });
    await env.DB.prepare("DELETE FROM courses WHERE course_id='swtest-2026'").run();
  });

  it("a staff member CANNOT create a course (owner-only → 403)", async () => {
    const res = await call("/admin/courses", {
      method: "POST",
      headers: { ...cookie(await staffSession()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ course_id: "hack-2026", name: "x" }).toString(),
    });
    expect(res.status).toBe(403);
    expect(await env.DB.prepare("SELECT 1 FROM courses WHERE course_id='hack-2026'").first()).toBe(null);
  });

  it("a staff member CANNOT manage staff (owner-only → 403, no escalation)", async () => {
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const res = await call("/c/ds-2026/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(await staffSession()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta02" }).toString(),
    });
    expect(res.status).toBe(403);
    expect((await env.DB.prepare("SELECT 1 FROM staff WHERE nycu_id='ta02'").first())).toBe(null);
  });

  // ── GitHub org/team sync (scope: team+org) ──────────────────────────────
  const syncEnv: Env = { ...testEnv, STAFF_TEAM: "staff" };
  const owner = () => signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
  const ghCalls = () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), url });
      return new Response(JSON.stringify({ state: "pending" }), { headers: { "Content-Type": "application/json" } });
    }));
    return calls;
  };
  const bindTA = (login: string) =>
    env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('ta01','T',7,?,'t','t')",
    ).bind(login).run();

  it("add → invites the bound TA to the org AND the staff team", async () => {
    await bindTA("monalisa");
    const calls = ghCalls();
    const res = await call("/c/ds-2026/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?staff_msg=ok");
    expect(calls).toContainEqual({ method: "PUT", url: "https://api.github.com/orgs/nycu-cs-course-ds/memberships/monalisa" });
    expect(calls).toContainEqual({ method: "PUT", url: "https://api.github.com/orgs/nycu-cs-course-ds/teams/staff/memberships/monalisa" });
  });

  it("remove → deletes the TA from the staff team AND the org", async () => {
    await bindTA("monalisa");
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const calls = ghCalls();
    const res = await call("/c/ds-2026/admin/staff/remove", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?staff_msg=ok");
    expect(calls).toContainEqual({ method: "DELETE", url: "https://api.github.com/orgs/nycu-cs-course-ds/teams/staff/memberships/monalisa" });
    expect(calls).toContainEqual({ method: "DELETE", url: "https://api.github.com/orgs/nycu-cs-course-ds/memberships/monalisa" });
  });

  it("add for an unbound TA → DB row created, no GitHub calls, no-binding flash", async () => {
    const calls = ghCalls();
    const res = await call("/c/ds-2026/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?staff_msg=no-binding");
    expect(await env.DB.prepare("SELECT 1 FROM staff WHERE nycu_id='ta01'").first()).not.toBe(null);
    expect(calls).toHaveLength(0);
  });

  it("a GitHub sync failure does not break the staff DB op (error flash)", async () => {
    await bindTA("monalisa");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const res = await call("/c/ds-2026/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?staff_msg=error");
    expect(await env.DB.prepare("SELECT 1 FROM staff WHERE nycu_id='ta01'").first()).not.toBe(null);
  });
});

describe("exam list on /me + /me/exam/<id>", () => {
  const sess = () => signSession({ exp: Date.now() + 60000, nycu: { id: "S9", name: "生" } }, SECRET);
  const ins = (pid: string, type: string, aid: string, title: string, repo: string, score: string) =>
    env.DB.prepare(
      "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo, assignment_id, assignment_type, assignment_title) VALUES ('ds-2026','S9',?,?,?,100,'t',?,?,?,?)",
    ).bind(pid, score ? "AC" : null, score || null, repo, aid, type, title).run();

  it("/me lists exams (link to /me/exam/<id>) and keeps labs flat", async () => {
    await ins("lab01-stack", "lab", "ds2026-lab01", "Lab 1", "org/lab01-stack-S9", "100");
    await ins("mid-p1", "exam", "mid", "期中考", "org/mid-p1-S9", "");   // not solved yet
    const body = await (await call("/me", { headers: cookie(await sess()) })).text();
    expect(body).toContain('href="/me/exam/mid"'); // exam → list link
    expect(body).toContain("期中考");
    expect(body).toContain("lab01-stack ↗");        // lab → flat row with repo link
    expect(body).not.toContain('href="/me/exam/ds2026-lab01"'); // lab is NOT in the exam list
  });

  it("/me/exam/<id> shows the exam's problems with repo links (own rows only)", async () => {
    await ins("mid-p1", "exam", "mid", "期中考", "org/mid-p1-S9", "");
    await ins("mid-p2", "exam", "mid", "期中考", "org/mid-p2-S9", "40");
    const res = await call("/me/exam/mid", { headers: cookie(await sess()) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("期中考");
    expect(body).toContain('href="https://github.com/org/mid-p1-S9"'); // 去解題
    expect(body).toContain('href="https://github.com/org/mid-p2-S9"');
    expect(body).toContain("去解題");
  });

  it("/me/exam/<id> with no rows for this student → 404", async () => {
    const res = await call("/me/exam/nonexistent", { headers: cookie(await sess()) });
    expect(res.status).toBe(404);
  });

  it("/me/exam/<id> requires login", async () => {
    const res = await call("/me/exam/mid");
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });
});

describe("binding queries (總表 + by GitHub org)", () => {
  const owner = () => signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
  const bind = (nycu: string, login: string) =>
    env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).bind(nycu, nycu, Math.floor(Math.random() * 1e6), login, "t", "t").run();

  it("/admin/bindings lists all bindings (independent of enrollment)", async () => {
    await bind("0856001", "ming");
    const res = await call("/admin/bindings", { headers: cookie(await owner()) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("所有綁定");
    expect(body).toContain("ming");
    expect(body).toContain("0856001");
    expect(body).toContain('href="/admin/org/nycu-cs-course-ds"'); // effective org link
  });

  it("/admin/bindings is auth-gated", async () => {
    const res = await call("/admin/bindings");
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });

  it("/admin/org/<org> joins org members/pending to bindings", async () => {
    await bind("0856001", "ming");   // will be a member
    await bind("0856002", "hua");    // pending
    await bind("0856003", "solo");   // not in org
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.includes("/members")) return new Response(JSON.stringify([{ login: "ming" }, { login: "ghost" }]), { headers: { "Content-Type": "application/json" } });
      if (u.includes("/invitations")) return new Response(JSON.stringify([{ login: "hua" }]), { headers: { "Content-Type": "application/json" } });
      throw new Error("unexpected " + u);
    }));
    const res = await call("/admin/org/nycu-cs-course-ds", { headers: cookie(await owner()) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("已加入"); // ming member badge
    expect(body).toContain("待接受"); // hua pending badge
    expect(body).toContain("未加入"); // solo not joined
    expect(body).toContain("ghost"); // org member with no maccount binding (unbound section)
  });

  it("/admin/org/<unknown> → 404", async () => {
    const res = await call("/admin/org/not-a-course-org", { headers: cookie(await owner()) });
    expect(res.status).toBe(404);
  });
});

describe("course edit + enrollment", () => {
  const owner = () => signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
  const staffSession = () => signSession({ exp: Date.now() + 60000, nycu: { id: "ta01", name: "助教" } }, SECRET);
  const post = async (path: string, fields: Record<string, string>, session: string) =>
    call(path, {
      method: "POST",
      headers: { ...cookie(session), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

  it("owner edits an existing course (re-upsert updates fields, keeps created_at)", async () => {
    const before = await env.DB.prepare("SELECT created_at FROM courses WHERE course_id='ds-2026'").first<{ created_at: string }>();
    const res = await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 一", moodle_course_id: "777", status: "archived" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    const row = await env.DB.prepare("SELECT name, moodle_course_id, status, created_at FROM courses WHERE course_id='ds-2026'").first();
    expect(row).toMatchObject({ name: "資料結構 一", moodle_course_id: "777", status: "archived" });
    expect((row as { created_at: string }).created_at).toBe(before!.created_at); // unchanged on update
    // restore for other tests
    await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 2026", status: "active" }, await owner());
  });

  it("owner imports enrollment by paste (additive)", async () => {
    const res = await post("/c/ds-2026/admin/enroll", { student_ids: "a01, a02\n a03" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    const { results } = await env.DB.prepare("SELECT student_id FROM enrollments WHERE course_id='ds-2026' ORDER BY student_id").all();
    expect(results.map((r) => r.student_id)).toEqual(["a01", "a02", "a03"]);
  });

  it("replace mode swaps the roster", async () => {
    await post("/c/ds-2026/admin/enroll", { student_ids: "a01 a02" }, await owner());
    await post("/c/ds-2026/admin/enroll", { student_ids: "a02 a03", replace: "1" }, await owner());
    const { results } = await env.DB.prepare("SELECT student_id FROM enrollments WHERE course_id='ds-2026' ORDER BY student_id").all();
    expect(results.map((r) => r.student_id)).toEqual(["a02", "a03"]);
  });

  it("a staff member cannot import enrollment (owner-only → 403)", async () => {
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const res = await post("/c/ds-2026/admin/enroll", { student_ids: "x" }, await staffSession());
    expect(res.status).toBe(403);
    expect(await env.DB.prepare("SELECT 1 FROM enrollments WHERE course_id='ds-2026'").first()).toBe(null);
  });

  it("token API ingest enrolls (and 404s an unknown course, 401s a bad token)", async () => {
    const ing = (body: unknown, tok = "ingest-secret") =>
      call("/api/enrollments/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
      });
    expect((await ing({ course_id: "ds-2026", student_ids: ["m1", "m2"] })).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM enrollments WHERE course_id='ds-2026'").first<{ n: number }>()).toMatchObject({ n: 2 });
    expect((await ing({ course_id: "nope", student_ids: ["x"] })).status).toBe(404);
    expect((await ing({ course_id: "ds-2026", student_ids: ["x"] }, "wrong")).status).toBe(401);
  });

  it("token API ingest resolves moodle_course_id → course_id", async () => {
    await env.DB.prepare("UPDATE courses SET moodle_course_id='21910' WHERE course_id='ds-2026'").run();
    const res = await call("/api/enrollments/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify({ moodle_course_id: 21910, student_ids: ["m9", "m8"], replace: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, course_id: "ds-2026", enrolled: 2 });
    const { results } = await env.DB.prepare("SELECT student_id FROM enrollments WHERE course_id='ds-2026' ORDER BY student_id").all();
    expect(results.map((r) => r.student_id)).toEqual(["m8", "m9"]);
    // an unmapped moodle id → 404
    const miss = await call("/api/enrollments/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify({ moodle_course_id: 99999, student_ids: ["x"] }),
    });
    expect(miss.status).toBe(404);
    await env.DB.prepare("UPDATE courses SET moodle_course_id=NULL WHERE course_id='ds-2026'").run();
  });

  it("course roster.csv narrows to enrolled ∩ bound once a roster exists", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('a01','甲',1,'alice','t','t')"),
      env.DB.prepare("INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('z99','乙',2,'zoe','t','t')"),
    ]);
    await post("/c/ds-2026/admin/enroll", { student_ids: "a01 b02" }, await owner()); // a01 bound, b02 not; z99 not enrolled
    const body = await (await call("/c/ds-2026/admin/roster.csv", { headers: cookie(await owner()) })).text();
    expect(body).toContain("alice,a01"); // enrolled ∩ bound
    expect(body).not.toContain("zoe");   // bound but NOT enrolled → excluded
  });

  it("course admin shows the enrollment section with bound/unbound", async () => {
    await env.DB.prepare("INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('a01','甲',1,'alice','t','t')").run();
    await post("/c/ds-2026/admin/enroll", { student_ids: "a01 b02" }, await owner());
    const body = await (await call("/c/ds-2026/admin", { headers: cookie(await owner()) })).text();
    expect(body).toContain("選課名單（2）");
    expect(body).toContain("課程設定"); // owner edit form
    expect(body).toContain('value="ds-2026"'); // settings form prefilled course_id
  });
});

describe("/me dashboard", () => {
  it("redirects anonymous users to NYCU login", async () => {
    const res = await call("/me");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });

  it("shows the bind-GitHub action when not yet bound, and no admin link for a normal user", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/me", { headers: cookie(session) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("/auth/github/start"); // bind action
    expect(body).toContain("尚未綁定");
    expect(body).not.toContain("管理功能"); // 314561004 is not in ADMIN_IDS
    // org-join CTA from COURSE_ORG
    expect(body).toContain("https://github.com/orgs/nycu-cs-course-ds/invitation");
    expect(body).toContain('href="/logout"'); // logout link
  });

  it("logout clears the session cookie and forces a re-prompted NYCU login", async () => {
    const res = await call("/logout");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start?prompt=login");
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0"); // cleared
  });

  it("/auth/nycu/start?prompt=login adds prompt=login to the NYCU authorize URL", async () => {
    const res = await call("/auth/nycu/start?prompt=login");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("prompt=login");
  });

  it("hides the org-join link when COURSE_ORG is unset", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/me", { headers: { ...cookie(session) } }, { ...testEnv, COURSE_ORG: "" });
    expect(await res.text()).not.toContain("/orgs/");
  });

  it("lists the effective org of each enrolled course (per-course github_org)", async () => {
    // A course with its own org; student enrolled only there.
    await env.DB.prepare(
      "INSERT INTO courses (course_id, name, github_org, status, created_at) VALUES ('swtest-2026','軟測','swtest-org','active','t')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('swtest-2026','314561004','student','t')",
    ).run();
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).toContain("https://github.com/orgs/swtest-org/invitation"); // its own org
    expect(body).not.toContain("/orgs/nycu-cs-course-ds/"); // not the shared one (enrolled elsewhere)
    await env.DB.prepare("DELETE FROM courses WHERE course_id='swtest-2026'").run();
  });

  it("a course with no github_org falls back to the shared COURSE_ORG", async () => {
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('ds-2026','314561004','student','t')",
    ).run();
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).toContain("https://github.com/orgs/nycu-cs-course-ds/invitation");
  });

  it("shows only the logged-in user's own grades, and the admin link for an admin", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('ds-2026','admin1','lab01-stack','AC',100,100,'t1')",
      ),
      env.DB.prepare(
        "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('ds-2026','999999999','lab01-stack','WA',0,100,'t2')",
      ),
    ]);
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/me", { headers: cookie(session) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("lab01-stack");
    expect(body).toContain("AC");
    expect(body).toContain("資料結構 2026"); // grades grouped under the course name
    expect(body).not.toContain("999999999"); // never another user's row
    expect(body).toContain("管理功能"); // admin1 ∈ ADMIN_IDS → admin link
  });

  it("groups a student's grades by course on /me", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('ds-2026','admin1','lab01-stack','AC',100,100,'t1')",
      ),
      env.DB.prepare(
        "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('ds-2027','admin1','lab09-x','WA',10,100,'t2')",
      ),
    ]);
    // ds-2027 isn't seeded → heading falls back to the course_id
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).toContain("資料結構 2026"); // seeded ds-2026 name
    expect(body.indexOf("資料結構 2026")).toBeLessThan(body.indexOf("ds-2027")); // ordered by course_id
    expect(body).toContain("lab09-x");
  });

  it("shows a success flash after binding (?bound=1)", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/me?bound=1", { headers: cookie(session) });
    expect(await res.text()).toContain("綁定成功");
  });

  it("renders English and sets a lang cookie with ?lang=en", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/me?lang=en", { headers: cookie(session) });
    const body = await res.text();
    expect(body).toContain("My Account");
    expect(body).toContain("Bind GitHub");
    expect(body).not.toContain("我的帳號");
    expect(res.headers.get("Set-Cookie")).toContain("lang=en");
  });

  it("honors a lang=en cookie when there is no ?lang", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/me", { headers: { Cookie: `${SESSION_COOKIE}=${session}; lang=en` } });
    expect(await res.text()).toContain("My Account");
  });
});

describe("/auth/github/start (bind from the dashboard)", () => {
  it("redirects a logged-in user to GitHub authorize", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/auth/github/start", { headers: cookie(session) });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("github.com/login/oauth/authorize");
    expect(res.headers.get("Set-Cookie")).toContain(SESSION_COOKIE);
  });

  it("redirects an anonymous user to NYCU login first", async () => {
    const res = await call("/auth/github/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });
});

describe("/api/grades/ingest", () => {
  const rows = [
    { student_id: "314561004", problem_id: "lab01-stack", verdict: "AC", score: 100, max_score: 100, updated_at: "t1" },
  ];

  it("rejects a missing/wrong token with 401 and writes nothing", async () => {
    const res = await call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
      body: JSON.stringify(rows),
    });
    expect(res.status).toBe(401);
    const { results } = await env.DB.prepare("SELECT * FROM grades").all();
    expect(results).toHaveLength(0);
  });

  it("upserts grades with the right token", async () => {
    const res = await call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify(rows),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, upserted: 1 });
    const row = await env.DB.prepare("SELECT * FROM grades WHERE student_id='314561004'").first();
    expect(row).toMatchObject({ problem_id: "lab01-stack", verdict: "AC", score: 100 });
  });

  it("defaults course_id to DEFAULT_COURSE_ID, and honors an explicit one", async () => {
    await call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify([
        rows[0], // no course_id → ds-2026 (back-compat)
        { ...rows[0], course_id: "ds-2027", problem_id: "lab09-x" }, // explicit
      ]),
    });
    const got = await env.DB
      .prepare("SELECT course_id, problem_id FROM grades WHERE student_id='314561004' ORDER BY course_id")
      .all<{ course_id: string; problem_id: string }>();
    expect(got.results).toEqual([
      { course_id: "ds-2026", problem_id: "lab01-stack" },
      { course_id: "ds-2027", problem_id: "lab09-x" },
    ]);
  });

  it("ignores extra fields (no test data ever stored)", async () => {
    await call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify([{ ...rows[0], expected_output: "SECRET", diff: "LEAK", stdin: "X" }]),
    });
    const cols = await env.DB.prepare("SELECT * FROM grades LIMIT 1").first();
    expect(Object.keys(cols ?? {})).toEqual([
      "course_id", "student_id", "problem_id", "verdict", "score", "max_score", "updated_at", "repo",
      "assignment_id", "assignment_type", "assignment_title",
    ]);
  });

  it("repo-only provisioning row keeps score null; a later grade fills it (COALESCE)", async () => {
    const ingest = (b: unknown) =>
      call("/api/grades/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
        body: JSON.stringify(b),
      });
    // provision push: repo + assignment, no score
    await ingest([{ course_id: "ds-2026", student_id: "S1", problem_id: "p1",
      repo: "org/p1-S1", assignment_id: "mid", assignment_type: "exam", assignment_title: "期中考", updated_at: "t1" }]);
    let row = await env.DB.prepare("SELECT score, repo, assignment_type FROM grades WHERE student_id='S1'").first<{ score: number | null; repo: string; assignment_type: string }>();
    expect(row?.score).toBe(null); // not 0 → /me shows "go solve"
    expect(row?.repo).toBe("org/p1-S1");
    // later grade push: score, no assignment_title → title preserved (COALESCE)
    await ingest([{ course_id: "ds-2026", student_id: "S1", problem_id: "p1", verdict: "AC", score: 90, max_score: 100, updated_at: "t2" }]);
    row = await env.DB.prepare("SELECT score, assignment_title FROM grades WHERE student_id='S1'").first();
    expect(row).toMatchObject({ score: 90, assignment_title: "期中考" });
  });

  it("stores the repo and /me links it; absent repo → no link", async () => {
    await call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify([
        { ...rows[0], student_id: "admin1", repo: "nycu-cs-course-ds/lab01-stack-skhuang" },
      ]),
    });
    const row = await env.DB.prepare("SELECT repo FROM grades WHERE student_id='admin1'").first<{ repo: string }>();
    expect(row?.repo).toBe("nycu-cs-course-ds/lab01-stack-skhuang");
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).toContain('href="https://github.com/nycu-cs-course-ds/lab01-stack-skhuang"');
  });
});

describe("/c/<id>/admin/roster.csv", () => {
  it("emits github_login,student_id for admins (only bound rows)", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('314561004','甲',1,'alice','t','t')",
      ),
    ]);
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/c/ds-2026/admin/roster.csv", { headers: cookie(session) });
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("github_login,student_id");
    expect(body).toContain("alice,314561004");
  });

  it("denies roster export to anonymous", async () => {
    const res = await call("/c/ds-2026/admin/roster.csv");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });
});

describe("/api/grades (token-auth pull for 程式作業自動批改)", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('ds-2026','AT9336','lab01-stack','AC',100,100,'t1')",
      ),
      env.DB.prepare(
        "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('ds-2026','B002','lab01-stack','WA',30,100,'t2')",
      ),
      env.DB.prepare(
        "INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('ds-2026','AT9336','lab02-queue','TLE',0,100,'t3')",
      ),
    ]);
  });

  it("returns grades for the given problem with the token", async () => {
    const res = await call("/api/grades?problem_id=lab01-stack", {
      headers: { Authorization: "Bearer ingest-secret" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      grades: { student_id: string; problem_id: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.grades.map((g) => g.student_id).sort()).toEqual(["AT9336", "B002"]);
    expect(body.grades.every((g) => g.problem_id === "lab01-stack")).toBe(true);
  });

  it("401 without a valid token", async () => {
    expect((await call("/api/grades?problem_id=lab01-stack")).status).toBe(401);
  });

  it("400 without problem_id", async () => {
    const res = await call("/api/grades", { headers: { Authorization: "Bearer ingest-secret" } });
    expect(res.status).toBe(400);
  });
});

describe("/api/roster (token-auth pull for the OJ roster-sync timer)", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('AT9336','師',1,'skhuang','t','t')",
    ).run();
  });

  it("returns github_login,student_id CSV with the right token", async () => {
    const res = await call("/api/roster", {
      headers: { Authorization: "Bearer ingest-secret" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("github_login,student_id");
    expect(body).toContain("skhuang,AT9336");
  });

  it("401 without a valid token (no NYCU session needed)", async () => {
    expect((await call("/api/roster")).status).toBe(401);
    expect(
      (await call("/api/roster", { headers: { Authorization: "Bearer nope" } })).status,
    ).toBe(401);
  });
});
