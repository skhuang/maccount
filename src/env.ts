import type { NycuConfig } from "./oauth/nycu";

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  PUBLIC_BASE_URL: string;
  FRONTEND_DONE_URL: string;
  ADMIN_IDS: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  // Google OAuth client (for binding a Google account + offline Drive access).
  // CLIENT_ID in wrangler.toml [vars]; CLIENT_SECRET via secret put.
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // OAuth scope requested at consent. Empty → DEFAULT_GOOGLE_SCOPE
  // (openid email + drive.file). wrangler.toml [vars] (not a secret).
  GOOGLE_SCOPE: string;
  // Symmetric key used to encrypt Google refresh tokens at rest in D1 (AES-GCM,
  // see crypto.ts). Any long random string. `wrangler secret put GOOGLE_TOKEN_KEY`.
  GOOGLE_TOKEN_KEY: string;
  NYCU_AUTHORIZE_URL: string;
  NYCU_TOKEN_URL: string;
  NYCU_USERINFO_URL: string;
  NYCU_SCOPE: string;
  NYCU_CLIENT_ID: string;
  NYCU_CLIENT_SECRET: string;
  // Shared secret the trusted OJ runner presents to POST /api/grades/ingest.
  // Set via `wrangler secret put GRADES_INGEST_TOKEN` (never in wrangler.toml).
  GRADES_INGEST_TOKEN: string;
  // Course GitHub org (slug). When set, /me shows a one-time "join the org"
  // invite link (orgs/<org>/invitation); empty = hide it. Set in wrangler.toml
  // [vars] (not a secret).
  COURSE_ORG: string;
  // Org-scoped GitHub token (Members: write). When set (with COURSE_ORG), a
  // student is auto-invited to the org right after binding GitHub, so the /me
  // link is immediately actionable. `wrangler secret put ORG_INVITE_TOKEN`.
  ORG_INVITE_TOKEN: string;
  // Org team slug for TA/staff (matches dsjudge's OJ_PROVISION_TEAM). When set
  // (with COURSE_ORG + ORG_INVITE_TOKEN), adding/removing a staff member in
  // /admin also syncs them to this org team (+ org). wrangler.toml [vars].
  STAFF_TEAM: string;
  // Default course-offering id used for back-compat until routes/ingest are
  // fully course-scoped (Phase 1b/2): the non-course-scoped /admin and grade
  // ingests without an explicit course_id fall back to this. wrangler.toml [vars].
  DEFAULT_COURSE_ID: string;
}

export function nycuConfig(env: Env): NycuConfig {
  return {
    authorizeUrl: env.NYCU_AUTHORIZE_URL,
    tokenUrl: env.NYCU_TOKEN_URL,
    userinfoUrl: env.NYCU_USERINFO_URL,
    clientId: env.NYCU_CLIENT_ID,
    clientSecret: env.NYCU_CLIENT_SECRET,
    scope: env.NYCU_SCOPE,
  };
}

export function isAdmin(env: Env, nycuId: string): boolean {
  return env.ADMIN_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(nycuId);
}
