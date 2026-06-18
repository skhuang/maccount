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

  it("serves the list to an admin session", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/admin", { headers: cookie(session) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("綁定名單");
  });

  it("exports CSV to an admin session", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/admin/export.csv", { headers: cookie(session) });
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(await res.text()).toContain("nycu_id,nycu_name");
  });

  it("denies CSV export to an anonymous request", async () => {
    const res = await call("/admin/export.csv");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });

  it("forbids CSV export to a logged-in non-admin (403)", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王" } },
      SECRET,
    );
    const res = await call("/admin/export.csv", { headers: cookie(session) });
    expect(res.status).toBe(403);
  });

  it("denies delete to an anonymous request and does not mutate", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('0856001','王',1,'octo','t','t')",
    ).run();
    const body = new URLSearchParams({ nycu_id: "0856001" });
    const res = await call("/admin/delete", {
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

  it("a staff-table member can view /admin (read-only: no delete / no manage-staff)", async () => {
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const res = await call("/admin", { headers: cookie(await staffSession()) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("綁定名單");
    expect(body).not.toContain('action="/admin/delete"');     // owner-only
    expect(body).not.toContain('action="/admin/staff/add"');  // owner-only
  });

  it("a logged-in non-staff non-owner is denied /admin (403)", async () => {
    const res = await call("/admin", { headers: cookie(await staffSession()) }); // ta01 not yet staff
    expect(res.status).toBe(403);
  });

  it("owner can add a staff member", async () => {
    const owner = await signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
    const res = await call("/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(owner), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    });
    expect(res.status).toBe(302);
    const { results } = await env.DB.prepare("SELECT nycu_id FROM staff").all();
    expect(results.map((r) => r.nycu_id)).toContain("ta01");
  });

  it("a staff member CANNOT manage staff (owner-only → 403, no escalation)", async () => {
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const res = await call("/admin/staff/add", {
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
    const res = await call("/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/admin?staff_msg=ok");
    expect(calls).toContainEqual({ method: "PUT", url: "https://api.github.com/orgs/nycu-cs-course-ds/memberships/monalisa" });
    expect(calls).toContainEqual({ method: "PUT", url: "https://api.github.com/orgs/nycu-cs-course-ds/teams/staff/memberships/monalisa" });
  });

  it("remove → deletes the TA from the staff team AND the org", async () => {
    await bindTA("monalisa");
    await env.DB.prepare("INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES ('ds-2026','ta01','admin1','t')").run();
    const calls = ghCalls();
    const res = await call("/admin/staff/remove", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/admin?staff_msg=ok");
    expect(calls).toContainEqual({ method: "DELETE", url: "https://api.github.com/orgs/nycu-cs-course-ds/teams/staff/memberships/monalisa" });
    expect(calls).toContainEqual({ method: "DELETE", url: "https://api.github.com/orgs/nycu-cs-course-ds/memberships/monalisa" });
  });

  it("add for an unbound TA → DB row created, no GitHub calls, no-binding flash", async () => {
    const calls = ghCalls();
    const res = await call("/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/admin?staff_msg=no-binding");
    expect(await env.DB.prepare("SELECT 1 FROM staff WHERE nycu_id='ta01'").first()).not.toBe(null);
    expect(calls).toHaveLength(0);
  });

  it("a GitHub sync failure does not break the staff DB op (error flash)", async () => {
    await bindTA("monalisa");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const res = await call("/admin/staff/add", {
      method: "POST",
      headers: { ...cookie(await owner()), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nycu_id: "ta01" }).toString(),
    }, syncEnv);
    expect(res.headers.get("Location")).toBe("/admin?staff_msg=error");
    expect(await env.DB.prepare("SELECT 1 FROM staff WHERE nycu_id='ta01'").first()).not.toBe(null);
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
    expect(body).not.toContain("999999999"); // never another user's row
    expect(body).toContain("管理功能"); // admin1 ∈ ADMIN_IDS → admin link
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
      "course_id", "student_id", "problem_id", "verdict", "score", "max_score", "updated_at",
    ]);
  });
});

describe("/admin/roster.csv", () => {
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
    const res = await call("/admin/roster.csv", { headers: cookie(session) });
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("github_login,student_id");
    expect(body).toContain("alice,314561004");
  });

  it("denies roster export to anonymous", async () => {
    const res = await call("/admin/roster.csv");
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
