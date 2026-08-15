import { env } from "cloudflare:test";
import { signSession, SESSION_COOKIE } from "../src/session";
import type { Env } from "../src/env";

// Shared env fixture for app-sso tests — mirrors the `testEnv: Env` object
// literal at the top of test/worker.test.ts (same DB binding, NYCU_* vars,
// SESSION_SECRET, PUBLIC_BASE_URL, etc.), plus the two relying-app SSO fields.
export async function makeEnv(): Promise<Env> {
  return {
    DB: env.DB,
    SESSION_SECRET: "test-secret",
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
    STAFF_TEAM: "",
    DEFAULT_COURSE_ID: "ds-2026",
    APP_ALLOWLIST: "dsvisual=https://skhuang.github.io/dsvisual",
    APP_TOKEN_SECRET: "s3cret",
  };
}

// A `maccount_session` cookie string for an already logged-in user (NYCU id
// `sub`), for tests that need to hit routes as a logged-in session.
export async function loggedInCookie(env: Env, sub: string): Promise<string> {
  const token = await signSession(
    { exp: Date.now() + 900000, nycu: { id: sub, name: sub } },
    env.SESSION_SECRET,
  );
  return `${SESSION_COOKIE}=${token}`;
}
