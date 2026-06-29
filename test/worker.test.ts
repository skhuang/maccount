import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { signSession, SESSION_COOKIE } from "../src/session";
import { listBindings } from "../src/db/bindings";
import { encryptSecret } from "../src/crypto";
import { GROUP_MEMBER_SCOPE, STAFF_GOOGLE_SCOPE } from "../src/oauth/drive";
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
  GOOGLE_CLIENT_ID: "g_id",
  GOOGLE_CLIENT_SECRET: "g_secret",
  GOOGLE_LOGIN_CLIENT_ID: "g_login_id",
  GOOGLE_LOGIN_CLIENT_SECRET: "g_login_secret",
  GOOGLE_SCOPE: "openid email https://www.googleapis.com/auth/drive.file",
  GOOGLE_TOKEN_KEY: "test-token-key",
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
  await env.DB.prepare("DELETE FROM course_forms").run();
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

describe("public pages", () => {
  it("serves the privacy policy without authentication", async () => {
    const res = await call("/privacy?lang=en");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("maccount Privacy Policy");
    expect(body).toContain("Google OAuth permissions");
  });

  it("serves the terms of service without authentication", async () => {
    const res = await call("/terms?lang=en");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("maccount Terms of Service");
    expect(body).toContain("Acceptable use");
  });
});

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

describe("/auth/google/start (bind from the dashboard)", () => {
  it("redirects a logged-in user to Google authorize", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/auth/google/start", { headers: cookie(session) });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("client_id")).toBe("g_id");
    expect(res.headers.get("Set-Cookie")).toContain(SESSION_COOKIE);
  });

  it("redirects an anonymous user to NYCU login first", async () => {
    const res = await call("/auth/google/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });

  it("?drive=1 requests the full drive scope (staff connect)", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } },
      SECRET,
    );
    const res = await call("/auth/google/start?drive=1", { headers: cookie(session) });
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.searchParams.get("scope")).toBe(STAFF_GOOGLE_SCOPE);
    expect(loc.searchParams.get("scope")).toContain("auth/drive");
    expect(loc.searchParams.get("scope")).not.toContain("drive.file");
  });
});

describe("/c/<id>/admin/drive/share", () => {
  const owner = () => signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
  // Seed the acting staff (admin1) with a connected Drive (full scope) token.
  const connectAdminDrive = async (scope = STAFF_GOOGLE_SCOPE) => {
    const enc = await encryptSecret("r_admin", "test-token-key");
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, google_refresh_token, google_scope, google_token_updated_at, created_at, updated_at) VALUES ('admin1','A',NULL,'adminsub','admin@gmail.com',?,?, 't','t','t')",
    ).bind(enc, scope).run();
  };
  const bindStudent = (id: string, email: string | null) =>
    env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, created_at, updated_at) VALUES (?,?,NULL,?,?,'t','t')",
    ).bind(id, id, `sub-${id}`, email).run();
  const enroll = (id: string) =>
    env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('ds-2026',?,'student','t')",
    ).bind(id).run();
  const post = (fields: Record<string, string>, session: string) =>
    call("/c/ds-2026/admin/drive/share", {
      method: "POST",
      headers: { ...cookie(session), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

  it("shares the file with each enrolled+bound student by Google email", async () => {
    await connectAdminDrive();
    await bindStudent("s1", "s1@gmail.com");
    await enroll("s1");
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/permissions")) {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ id: "p1" }), { headers: { "Content-Type": "application/json" } });
      }
      throw new Error("unexpected fetch " + url);
    }));
    const res = await post({ file_id: "https://drive.google.com/drive/folders/FOLDER1", role: "reader" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?drive_msg=done%3A1%3A0%3A0");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/files/FOLDER1/permissions"); // id parsed from the folder URL
    expect(calls[0].body).toEqual({ role: "reader", type: "user", emailAddress: "s1@gmail.com" });
  });

  it("skips enrolled students with no bound Google account", async () => {
    await connectAdminDrive();
    await bindStudent("s1", "s1@gmail.com");
    await bindStudent("s2", null); // bound github only, no google
    await enroll("s1");
    await enroll("s2");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/permissions")) { calls.push(url); return new Response("{}", { headers: { "Content-Type": "application/json" } }); }
      throw new Error("unexpected " + url);
    }));
    const res = await post({ file_id: "FILE1" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?drive_msg=done%3A1%3A0%3A1"); // shared 1, skipped 1
    expect(calls).toHaveLength(1);
  });

  it("flashes no-drive (and makes no Drive calls) when the staff hasn't connected full-scope Drive", async () => {
    await connectAdminDrive("openid email https://www.googleapis.com/auth/drive.file"); // drive.file only
    await bindStudent("s1", "s1@gmail.com");
    await enroll("s1");
    const fetchSpy = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post({ file_id: "FILE1" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?drive_msg=no-drive");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flashes no-file when no file id is given", async () => {
    await connectAdminDrive();
    const res = await post({ file_id: "  " }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?drive_msg=no-file");
  });

  it("forbids a logged-in non-staff (403)", async () => {
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "0856001", name: "王" } }, SECRET);
    const res = await post({ file_id: "FILE1" }, session);
    expect(res.status).toBe(403);
  });

  it("redirects an anonymous request to NYCU login", async () => {
    const res = await post({ file_id: "FILE1" }, "");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start");
  });
});

describe("/auth/google/callback (bind happy path)", () => {
  const stubGoogle = (sub: number | string, email: string, refresh: string | null = "r_tok") =>
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({
          access_token: "g_tok", scope: "openid email https://www.googleapis.com/auth/drive.file",
          ...(refresh ? { refresh_token: refresh } : {}),
        }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("userinfo"))
        return new Response(JSON.stringify({ sub: String(sub), email }), { headers: { "Content-Type": "application/json" } });
      throw new Error("unexpected fetch " + url);
    }));

  it("upserts a google binding and redirects to /me?gbound=1", async () => {
    stubGoogle("108sub", "ming@gmail.com");
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王小明" }, gostate: "GO" },
      SECRET,
    );
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/me?gbound=1");
    const row = await env.DB.prepare("SELECT google_sub, google_email FROM bindings WHERE nycu_id='0856001'").first();
    expect(row).toMatchObject({ google_sub: "108sub", google_email: "ming@gmail.com" });
  });

  it("stores the refresh token encrypted (not plaintext) + the granted scope, and it decrypts back", async () => {
    stubGoogle("108sub", "ming@gmail.com", "r_tok");
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王小明" }, gostate: "GO" },
      SECRET,
    );
    await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    const row = await env.DB
      .prepare("SELECT google_refresh_token, google_scope, google_token_updated_at FROM bindings WHERE nycu_id='0856001'")
      .first<{ google_refresh_token: string; google_scope: string; google_token_updated_at: string }>();
    expect(row?.google_refresh_token).toBeTruthy();
    expect(row?.google_refresh_token).not.toBe("r_tok"); // encrypted at rest
    expect(row?.google_scope).toContain("drive.file");
    expect(row?.google_token_updated_at).toBeTruthy();
    const { decryptSecret } = await import("../src/crypto");
    expect(await decryptSecret(row!.google_refresh_token, "test-token-key")).toBe("r_tok");
  });

  it("a re-consent without a refresh token keeps the previously stored one (COALESCE)", async () => {
    stubGoogle("108sub", "ming@gmail.com", "r_tok"); // first bind: stores token
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王小明" }, gostate: "GO" },
      SECRET,
    );
    await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    const first = await env.DB.prepare("SELECT google_refresh_token FROM bindings WHERE nycu_id='0856001'").first<{ google_refresh_token: string }>();
    stubGoogle("108sub", "ming@gmail.com", null); // re-bind: Google returns no refresh token
    await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    const second = await env.DB.prepare("SELECT google_refresh_token FROM bindings WHERE nycu_id='0856001'").first<{ google_refresh_token: string }>();
    expect(second?.google_refresh_token).toBe(first?.google_refresh_token); // not wiped
  });

  it("redirects with error when the google account is already bound elsewhere", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, created_at, updated_at) VALUES ('other','x',NULL,'108sub','ming@gmail.com','t','t')",
    ).run();
    stubGoogle("108sub", "ming@gmail.com");
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "0856001", name: "王" }, gostate: "GO" },
      SECRET,
    );
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe("/me?error=google_already_bound");
  });

  it("surfaces a Google OAuth error to the done page", async () => {
    const res = await call("/auth/google/callback?error=access_denied&state=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=err&reason=google_access_denied",
    );
  });

  it("rejects a state mismatch", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "x", name: "x" }, gostate: "GO" },
      SECRET,
    );
    const res = await call("/auth/google/callback?code=abc&state=WRONG", { headers: cookie(session) });
    expect(res.status).toBe(400);
  });
});

describe("sign in with GitHub / Google (login via an existing binding)", () => {
  const sessionToken = (res: Response) => {
    const setc = res.headers.get("Set-Cookie") ?? "";
    return setc.split(";")[0].split("=").slice(1).join("=");
  };

  it("/auth/github/login redirects to GitHub with a state-only session (no NYCU needed)", async () => {
    const res = await call("/auth/github/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("github.com/login/oauth/authorize");
    expect(res.headers.get("Set-Cookie")).toContain(SESSION_COOKIE);
  });

  it("/auth/google/login requests identity only (no Drive/offline)", async () => {
    const res = await call("/auth/google/login");
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("client_id")).toBe("g_login_id");
    expect(loc.searchParams.get("scope")).toBe("openid email");
    expect(loc.searchParams.get("access_type")).toBe(null);
  });

  it("/auth/google/login falls back to the binding client when no separate login client is configured", async () => {
    const fallbackEnv: Env = { ...testEnv, GOOGLE_LOGIN_CLIENT_ID: "", GOOGLE_LOGIN_CLIENT_SECRET: undefined };
    const res = await call("/auth/google/login", undefined, fallbackEnv);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.searchParams.get("client_id")).toBe("g_id");
  });

  it("GitHub login resolves the binding and logs in as that NYCU account", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('0856001','王小明',999,'octo','t','t')",
    ).run();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("access_token"))
        return new Response(JSON.stringify({ access_token: "t" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ id: 999, login: "octo" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gstate: "GS" }, SECRET); // NO nycu
    const res = await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe("/me");
    // the issued session is logged in as the bound NYCU account
    const me = await call("/me", { headers: cookie(sessionToken(res)) });
    expect(me.status).toBe(200);
    expect(await me.text()).toContain("0856001");
  });

  it("GitHub login with an unbound account → done page error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("access_token"))
        return new Response(JSON.stringify({ access_token: "t" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ id: 555, login: "stranger" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gstate: "GS" }, SECRET);
    const res = await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=err&reason=github_not_bound",
    );
  });

  it("GitHub login rejects a state mismatch", async () => {
    const session = await signSession({ exp: Date.now() + 60000, gstate: "GS" }, SECRET);
    const res = await call("/auth/github/callback?code=abc&state=WRONG", { headers: cookie(session) });
    expect(res.status).toBe(400);
  });

  it("Google login resolves the binding and logs in as that NYCU account", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, created_at, updated_at) VALUES ('0856001','王小明',NULL,'108sub','m@gmail.com','t','t')",
    ).run();
    let tokenBody = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token")) {
        tokenBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ access_token: "t" }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ sub: "108sub", email: "m@gmail.com" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gostate: "GO", googleMode: "login" }, SECRET); // NO nycu
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe("/me");
    expect(new URLSearchParams(tokenBody).get("client_id")).toBe("g_login_id");
    expect(new URLSearchParams(tokenBody).get("client_secret")).toBe("g_login_secret");
    const me = await call("/me", { headers: cookie(sessionToken(res)) });
    expect(await me.text()).toContain("0856001");
  });

  it("Google login with an unbound account → done page error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "t" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ sub: "unknown", email: "x@gmail.com" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gostate: "GO", googleMode: "login" }, SECRET);
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=err&reason=google_not_bound",
    );
  });

  it("Google login can resolve an unbound Gmail account via Moodle enrollment email", async () => {
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, email, role, created_at) VALUES ('ds-2026','0856001','m@gmail.com','student','t')",
    ).run();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "t", scope: "openid email" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ sub: "newsub", email: "m@gmail.com" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gostate: "GO", googleMode: "login" }, SECRET);
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe("/me");
    const me = await call("/me", { headers: cookie(sessionToken(res)) });
    expect(await me.text()).toContain("0856001");
    const row = await env.DB.prepare("SELECT nycu_id, google_sub, google_email FROM bindings WHERE nycu_id='0856001'").first();
    expect(row).toMatchObject({ nycu_id: "0856001", google_sub: "newsub", google_email: "m@gmail.com" });
  });

  it("Google login can resolve an unbound NYCU Workspace account via Moodle enrollment email", async () => {
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, email, role, created_at) VALUES ('ds-2026','0856002','student@nycu.edu.tw','student','t')",
    ).run();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "t", scope: "openid email" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ sub: "nycusub", email: "student@nycu.edu.tw" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gostate: "GO", googleMode: "login" }, SECRET);
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe("/me");
    const me = await call("/me", { headers: cookie(sessionToken(res)) });
    expect(await me.text()).toContain("0856002");
    const row = await env.DB.prepare("SELECT nycu_id, google_sub, google_email FROM bindings WHERE nycu_id='0856002'").first();
    expect(row).toMatchObject({ nycu_id: "0856002", google_sub: "nycusub", google_email: "student@nycu.edu.tw" });
  });

  it("Google login does not use other Moodle email domains as an unbound fallback", async () => {
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, email, role, created_at) VALUES ('ds-2026','0856001','student@example.com','student','t')",
    ).run();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "t", scope: "openid email" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ sub: "newsub", email: "student@example.com" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gostate: "GO", googleMode: "login" }, SECRET);
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=err&reason=google_not_bound",
    );
  });

  it("Google login rejects an ambiguous Moodle Gmail match", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO enrollments (course_id, student_id, email, role, created_at) VALUES ('ds-2026','a','same@gmail.com','student','t')"),
      env.DB.prepare("INSERT INTO enrollments (course_id, student_id, email, role, created_at) VALUES ('ds-2026','b','same@gmail.com','student','t')"),
    ]);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "t", scope: "openid email" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ sub: "newsub", email: "same@gmail.com" }), { headers: { "Content-Type": "application/json" } });
    }));
    const session = await signSession({ exp: Date.now() + 60000, gostate: "GO", googleMode: "login" }, SECRET);
    const res = await call("/auth/google/callback?code=abc&state=GO", { headers: cookie(session) });
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=err&reason=google_email_ambiguous",
    );
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
    expect(body).toContain("<th>Google</th>"); // google column in the correspondence table
    expect(body).toContain('href="/admin/org/nycu-cs-course-ds"'); // effective org link
  });

  it("/admin/bindings shows a bound student's Google email", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, google_sub, google_email, created_at, updated_at) VALUES ('0856009','陳',9,'chen','sub9','chen@gmail.com','t','t')",
    ).run();
    const body = await (await call("/admin/bindings", { headers: cookie(await owner()) })).text();
    expect(body).toContain("chen@gmail.com");
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

  it("owner sets an optional google_classroom_id (persists + prefills the form)", async () => {
    const res = await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 2026", google_classroom_id: "CR-789" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    const row = await env.DB.prepare("SELECT google_classroom_id FROM courses WHERE course_id='ds-2026'").first();
    expect(row).toMatchObject({ google_classroom_id: "CR-789" });
    const body = await (await call("/c/ds-2026/admin", { headers: cookie(await owner()) })).text();
    expect(body).toContain('name="google_classroom_id" value="CR-789"');
    await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 2026" }, await owner()); // restore
  });

  it("owner sets an optional google_meet_url (persists + prefills the form)", async () => {
    const res = await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 2026", google_meet_url: "https://meet.google.com/abc-defg-hij" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    const row = await env.DB.prepare("SELECT google_meet_url FROM courses WHERE course_id='ds-2026'").first();
    expect(row).toMatchObject({ google_meet_url: "https://meet.google.com/abc-defg-hij" });
    const body = await (await call("/c/ds-2026/admin", { headers: cookie(await owner()) })).text();
    expect(body).toContain('name="google_meet_url" value="https://meet.google.com/abc-defg-hij"');
    await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 2026" }, await owner()); // restore
  });

  it("owner sets an optional google_group_email (persists + prefills the form)", async () => {
    const group = "maccount-ds-2026@example.edu";
    const res = await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 2026", google_group_email: group }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    const row = await env.DB.prepare("SELECT google_group_email FROM courses WHERE course_id='ds-2026'").first();
    expect(row).toMatchObject({ google_group_email: group });
    const body = await (await call("/c/ds-2026/admin", { headers: cookie(await owner()) })).text();
    expect(body).toContain(`name="google_group_email" type="email" value="${group}"`);
    expect(body).toContain(`<code>${group}</code>`);
    await post("/admin/courses", { course_id: "ds-2026", name: "資料結構 2026" }, await owner()); // restore
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

  it("token API ingest stores Moodle participant email rows", async () => {
    const res = await call("/api/enrollments/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify({
        course_id: "ds-2026",
        students: [
          { student_id: "m1", email: "m1@nycu.edu.tw" },
          { student_id: "m2", email: "" },
        ],
        replace: true,
      }),
    });
    expect(res.status).toBe(200);
    const { results } = await env.DB.prepare("SELECT student_id, email FROM enrollments WHERE course_id='ds-2026' ORDER BY student_id").all();
    expect(results).toEqual([
      { student_id: "m1", email: "m1@nycu.edu.tw" },
      { student_id: "m2", email: null },
    ]);
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
    expect(body).toContain("/auth/google/start"); // google bind action
    expect(body).toContain("綁定 Google");
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

  it("lists an enrolled course on /me even before any grade/assignment exists", async () => {
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('ds-2026','314561004','student','t')",
    ).run();
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).toContain("我的課程");                    // course-list heading
    expect(body).toContain("資料結構 2026");                // enrolled course name (seeded)
    expect(body).toContain("此課程目前沒有作業或成績");        // empty-course note
  });

  it("shows the course's Google Meet link on /me for an enrolled student", async () => {
    await env.DB.prepare("UPDATE courses SET google_meet_url='https://meet.google.com/abc-defg-hij' WHERE course_id='ds-2026'").run();
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('ds-2026','314561004','student','t')",
    ).run();
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).toContain("加入 Google Meet");
    expect(body).toContain('href="https://meet.google.com/abc-defg-hij"');
    await env.DB.prepare("UPDATE courses SET google_meet_url=NULL WHERE course_id='ds-2026'").run(); // restore
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

  it("shows a success flash after binding google (?gbound=1), and the bound email", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, created_at, updated_at) VALUES ('314561004','甲',NULL,'108sub','ming@gmail.com','t','t')",
    ).run();
    const session = await signSession(
      { exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } },
      SECRET,
    );
    const res = await call("/me?gbound=1", { headers: cookie(session) });
    const body = await res.text();
    expect(body).toContain("Google 綁定成功");
    expect(body).toContain("ming@gmail.com"); // shows the bound google email
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

describe("pre-enrollment landing /me/<course_id>", () => {
  it("anonymous visitor is sent to NYCU login carrying next", async () => {
    const res = await call("/me/ds-2026");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start?next=%2Fme%2Fds-2026");
  });

  it("logged-in: shows binding + pre-enroll form, hides regular form; unknown course → 404", async () => {
    await env.DB.prepare(
      "INSERT INTO course_forms (course_id, title, url, pre_enroll, created_at) VALUES ('ds-2026','報到問卷','https://forms.gle/pre',1,'t')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO course_forms (course_id, title, url, pre_enroll, created_at) VALUES ('ds-2026','一般問卷','https://forms.gle/reg',0,'t')",
    ).run();
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "S1", name: "生" } }, SECRET);
    const res = await call("/me/ds-2026", { headers: cookie(session) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("資料結構 2026");
    expect(body).toContain("報到問卷");
    expect(body).toContain('href="https://forms.gle/pre"');
    expect(body).not.toContain("一般問卷");       // regular form is not on the prejoin page
    expect(body).toContain("/auth/github/start"); // bind GitHub action
    expect(body).toContain("/auth/google/start"); // bind Google action
    expect((await call("/me/nope", { headers: cookie(session) })).status).toBe(404);
  });

  it("NYCU callback honors a safe next and rejects an unsafe one", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("token"))
        return new Response(JSON.stringify({ access_token: "n_tok" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ username: "S1", name: "生" }), { headers: { "Content-Type": "application/json" } });
    }));
    const safe = await signSession({ exp: Date.now() + 60000, nstate: "NS", next: "/me/ds-2026" }, SECRET);
    const r1 = await call("/auth/nycu/callback?code=x&state=NS", { headers: cookie(safe) });
    expect(r1.headers.get("Location")).toBe("/me/ds-2026");
    const unsafe = await signSession({ exp: Date.now() + 60000, nstate: "NS", next: "https://evil.example/x" }, SECRET);
    const r2 = await call("/auth/nycu/callback?code=x&state=NS", { headers: cookie(unsafe) });
    expect(r2.headers.get("Location")).toBe("/me"); // open-redirect rejected
  });
});

describe("course Google Forms", () => {
  const owner = () => signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
  const post = (path: string, fields: Record<string, string>, session: string) =>
    call(path, {
      method: "POST",
      headers: { ...cookie(session), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

  it("staff adds a form; it persists and shows in the admin page", async () => {
    const res = await post(
      "/c/ds-2026/admin/forms/add",
      { title: "課程意見調查", url: "https://docs.google.com/forms/d/abc/viewform" },
      await owner(),
    );
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    const row = await env.DB.prepare("SELECT title, url FROM course_forms WHERE course_id='ds-2026'").first();
    expect(row).toMatchObject({ title: "課程意見調查", url: "https://docs.google.com/forms/d/abc/viewform" });
    const body = await (await call("/c/ds-2026/admin", { headers: cookie(await owner()) })).text();
    expect(body).toContain("課程意見調查");
    expect(body).toContain('href="https://docs.google.com/forms/d/abc/viewform"');
  });

  it("rejects a non-http(s) url (flash, no insert)", async () => {
    const res = await post(
      "/c/ds-2026/admin/forms/add",
      { title: "x", url: "javascript:alert(1)" },
      await owner(),
    );
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?forms_msg=bad");
    expect(await env.DB.prepare("SELECT 1 FROM course_forms").first()).toBe(null);
  });

  it("removes a form (scoped by id)", async () => {
    await env.DB.prepare(
      "INSERT INTO course_forms (course_id, title, url, created_at) VALUES ('ds-2026','A','https://forms.gle/a','t')",
    ).run();
    const id = (await env.DB.prepare("SELECT id FROM course_forms").first<{ id: number }>())!.id;
    const res = await post("/c/ds-2026/admin/forms/remove", { id: String(id) }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    expect(await env.DB.prepare("SELECT 1 FROM course_forms").first()).toBe(null);
  });

  it("forbids a logged-in non-staff from adding a form (403)", async () => {
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "0856001", name: "王" } }, SECRET);
    const res = await post("/c/ds-2026/admin/forms/add", { title: "x", url: "https://forms.gle/a" }, session);
    expect(res.status).toBe(403);
    expect(await env.DB.prepare("SELECT 1 FROM course_forms").first()).toBe(null);
  });

  it("shows a course's forms to an enrolled student on /me", async () => {
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('ds-2026','314561004','student','t')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO course_forms (course_id, title, url, created_at) VALUES ('ds-2026','期末回饋','https://forms.gle/feedback','t')",
    ).run();
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).toContain("期末回饋");
    expect(body).toContain('href="https://forms.gle/feedback"');
  });

  it("excludes pre-enrollment forms from the enrolled /me dashboard", async () => {
    await env.DB.prepare(
      "INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('ds-2026','314561004','student','t')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO course_forms (course_id, title, url, pre_enroll, created_at) VALUES ('ds-2026','報到問卷','https://forms.gle/pre',1,'t')",
    ).run();
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "314561004", name: "甲" } }, SECRET);
    const body = await (await call("/me", { headers: cookie(session) })).text();
    expect(body).not.toContain("報到問卷"); // pre-enroll form only on /me/<course_id>
  });

  // Seed the acting staff (admin1) with a connected Drive (full scope) token so
  // the Forms API create can act as them.
  const connectAdminDrive = async (scope = STAFF_GOOGLE_SCOPE) => {
    const enc = await encryptSecret("r_admin", "test-token-key");
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, google_refresh_token, google_scope, google_token_updated_at, created_at, updated_at) VALUES ('admin1','A',NULL,'adminsub','admin@gmail.com',?,?, 't','t','t')",
    ).bind(enc, scope).run();
  };
  const setGroup = (group: string | null) =>
    env.DB.prepare("UPDATE courses SET google_group_email=? WHERE course_id='ds-2026'").bind(group).run();
  const bindStudent = (sid: string, email: string | null) =>
    env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, created_at, updated_at) VALUES (?,?,NULL,?,?,'t','t')",
    ).bind(sid, sid, `sub-${sid}`, email).run();
  const enroll = (sid: string, email: string | null = null) =>
    env.DB.prepare("INSERT INTO enrollments (course_id, student_id, email, role, created_at) VALUES ('ds-2026',?,?,'student','t')")
      .bind(sid, email).run();

  it("creates a Google Form via the API and attaches it (stores form_id + responderUri)", async () => {
    await connectAdminDrive();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("forms.googleapis.com/v1/forms"))
        return new Response(JSON.stringify({ formId: "F123", responderUri: "https://docs.google.com/forms/d/e/F123/viewform" }), { headers: { "Content-Type": "application/json" } });
      throw new Error("unexpected fetch " + url);
    }));
    const res = await post("/c/ds-2026/admin/forms/create", { title: "第一週小考" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin");
    const row = await env.DB.prepare("SELECT title, url, form_id FROM course_forms WHERE course_id='ds-2026'").first();
    expect(row).toMatchObject({
      title: "第一週小考",
      url: "https://docs.google.com/forms/d/e/F123/viewform",
      form_id: "F123",
    });
    // admin page exposes the edit link for an API-created form
    const body = await (await call("/c/ds-2026/admin", { headers: cookie(await owner()) })).text();
    expect(body).toContain("https://docs.google.com/forms/d/F123/edit");
  });

  it("create flashes no-drive when the staff hasn't connected Google Drive", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post("/c/ds-2026/admin/forms/create", { title: "x" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?forms_msg=no-drive");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT 1 FROM course_forms").first()).toBe(null);
  });

  it("create flashes create-error when the Forms API fails (no row stored)", async () => {
    await connectAdminDrive();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      return new Response("nope", { status: 500 }); // forms create fails
    }));
    const res = await post("/c/ds-2026/admin/forms/create", { title: "x" }, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?forms_msg=create-error");
    expect(await env.DB.prepare("SELECT 1 FROM course_forms").first()).toBe(null);
  });

  it("syncs suggested responder emails into the configured Google Group", async () => {
    await setGroup("course-group@example.edu");
    await connectAdminDrive();
    await bindStudent("s1", "s1@gmail.com");
    await bindStudent("s2", "same@gmail.com");
    await enroll("s1", "s1@nycu.edu.tw");
    await enroll("s2", "same@gmail.com"); // duplicate with bound Google
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? "GET";
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET" && url.includes("admin.googleapis.com/admin/directory/v1/groups"))
        return new Response(JSON.stringify({
          members: [
            { id: "old-id", email: "old@gmail.com", role: "MEMBER", type: "USER" },
            { id: "owner-id", email: "owner@example.edu", role: "OWNER", type: "USER" },
            { id: "s1-id", email: "s1@gmail.com", role: "MEMBER", type: "USER" },
          ],
        }), { headers: { "Content-Type": "application/json" } });
      if (method === "POST" && url.includes("/members"))
        return new Response("{}", { headers: { "Content-Type": "application/json" } });
      if (method === "DELETE" && url.includes("/members/old-id"))
        return new Response(null, { status: 204 });
      throw new Error("unexpected fetch " + method + " " + url);
    }));

    const res = await post("/c/ds-2026/admin/forms/group/sync", {}, await owner());

    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?forms_msg=group-done%3A2%3A1%3A1%3A1%3A0");
    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", body: { email: "s1@nycu.edu.tw", role: "MEMBER" } }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", body: { email: "same@gmail.com", role: "MEMBER" } }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", url: expect.stringContaining("/members/old-id") }));
    expect(calls.some((c) => c.url.includes("owner-id"))).toBe(false);
    await setGroup(null);
  });

  it("group sync flashes group-missing without calling Google when no group is configured", async () => {
    await setGroup(null);
    await connectAdminDrive();
    const fetchSpy = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post("/c/ds-2026/admin/forms/group/sync", {}, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?forms_msg=group-missing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("group sync asks staff to reconnect Google when the token lacks the group-member scope", async () => {
    await setGroup("course-group@example.edu");
    await connectAdminDrive(STAFF_GOOGLE_SCOPE.replace(` ${GROUP_MEMBER_SCOPE}`, ""));
    const fetchSpy = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post("/c/ds-2026/admin/forms/group/sync", {}, await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?forms_msg=group-scope");
    expect(fetchSpy).not.toHaveBeenCalled();
    await setGroup(null);
  });
});

describe("course Google Classroom invite", () => {
  const owner = () => signSession({ exp: Date.now() + 60000, nycu: { id: "admin1", name: "A" } }, SECRET);
  const post = (path: string, session: string) =>
    call(path, { method: "POST", headers: { ...cookie(session), "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
  const connectAdminDrive = async () => {
    const enc = await encryptSecret("r_admin", "test-token-key");
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, google_refresh_token, google_scope, google_token_updated_at, created_at, updated_at) VALUES ('admin1','A',NULL,'adminsub','admin@gmail.com',?,?, 't','t','t')",
    ).bind(enc, STAFF_GOOGLE_SCOPE).run();
  };
  const setClassroom = (id: string | null) =>
    env.DB.prepare("UPDATE courses SET google_classroom_id=? WHERE course_id='ds-2026'").bind(id).run();
  const bindStudent = (sid: string, email: string | null) =>
    env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, google_sub, google_email, created_at, updated_at) VALUES (?,?,NULL,?,?,'t','t')",
    ).bind(sid, sid, `sub-${sid}`, email).run();
  const enroll = (sid: string) =>
    env.DB.prepare("INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('ds-2026',?,'student','t')").bind(sid).run();

  it("invites enrolled+bound students into the Classroom; skips no-Google", async () => {
    await setClassroom("CR-789");
    await connectAdminDrive();
    await bindStudent("s1", "s1@gmail.com");
    await bindStudent("s2", null); // bound github only
    await enroll("s1");
    await enroll("s2");
    const invites: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("classroom.googleapis.com/v1/invitations")) {
        invites.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "inv" }), { headers: { "Content-Type": "application/json" } });
      }
      throw new Error("unexpected fetch " + url);
    }));
    const res = await post("/c/ds-2026/admin/classroom/invite", await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?classroom_msg=done%3A1%3A0%3A0%3A1");
    expect(invites).toEqual([{ courseId: "CR-789", userId: "s1@gmail.com", role: "STUDENT" }]);
    await setClassroom(null); // restore
  });

  it("decodes a pasted /c/ URL token to the numeric course id before inviting", async () => {
    await setClassroom("ODU1Mjg4MTUxNzg2"); // the classroom.google.com/c/<token> form
    await connectAdminDrive();
    await bindStudent("s1", "s1@gmail.com");
    await enroll("s1");
    const invites: { courseId?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      invites.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "inv" }), { headers: { "Content-Type": "application/json" } });
    }));
    const res = await post("/c/ds-2026/admin/classroom/invite", await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?classroom_msg=done%3A1%3A0%3A0%3A0");
    expect(invites[0].courseId).toBe("855288151786"); // decoded from the URL token
    await setClassroom(null);
  });

  it("counts an already-member (409) separately", async () => {
    await setClassroom("CR-789");
    await connectAdminDrive();
    await bindStudent("s1", "s1@gmail.com");
    await enroll("s1");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "fresh" }), { headers: { "Content-Type": "application/json" } });
      return new Response("conflict", { status: 409 }); // already invited/member
    }));
    const res = await post("/c/ds-2026/admin/classroom/invite", await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?classroom_msg=done%3A0%3A1%3A0%3A0");
    await setClassroom(null);
  });

  it("flashes no-classroom when the course has no Classroom id", async () => {
    await setClassroom(null);
    await connectAdminDrive();
    const fetchSpy = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post("/c/ds-2026/admin/classroom/invite", await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?classroom_msg=no-classroom");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flashes no-drive when the staff hasn't connected Google", async () => {
    await setClassroom("CR-789");
    const fetchSpy = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post("/c/ds-2026/admin/classroom/invite", await owner());
    expect(res.headers.get("Location")).toBe("/c/ds-2026/admin?classroom_msg=no-drive");
    expect(fetchSpy).not.toHaveBeenCalled();
    await setClassroom(null);
  });

  it("forbids a logged-in non-staff (403)", async () => {
    await setClassroom("CR-789");
    const session = await signSession({ exp: Date.now() + 60000, nycu: { id: "0856001", name: "王" } }, SECRET);
    const res = await post("/c/ds-2026/admin/classroom/invite", session);
    expect(res.status).toBe(403);
    await setClassroom(null);
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
