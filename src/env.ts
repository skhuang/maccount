import type { NycuConfig } from "./oauth/nycu";

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  PUBLIC_BASE_URL: string;
  FRONTEND_DONE_URL: string;
  ADMIN_IDS: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
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
