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
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM bindings").run();
  await env.DB.prepare("DELETE FROM grades").run();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function cookie(token: string): HeadersInit {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}
function call(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://api.example${path}`, init), testEnv);
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
  });

  it("shows only the logged-in user's own grades, and the admin link for an admin", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO grades (student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('admin1','lab01-stack','AC',100,100,'t1')",
      ),
      env.DB.prepare(
        "INSERT INTO grades (student_id, problem_id, verdict, score, max_score, updated_at) VALUES ('999999999','lab01-stack','WA',0,100,'t2')",
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

  it("ignores extra fields (no test data ever stored)", async () => {
    await call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify([{ ...rows[0], expected_output: "SECRET", diff: "LEAK", stdin: "X" }]),
    });
    const cols = await env.DB.prepare("SELECT * FROM grades LIMIT 1").first();
    expect(Object.keys(cols ?? {})).toEqual([
      "student_id", "problem_id", "verdict", "score", "max_score", "updated_at",
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
