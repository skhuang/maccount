# NYCU ↔ GitHub 帳號對應服務 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者用 NYCU OAuth 登入確認身分後綁定 GitHub 帳號，建立可匯出的 NYCU↔GitHub 對應表，並提供管理後台。

**Architecture:** 靜態前端放 `skhuang.github.io/maccount`（入口/結果頁）；Cloudflare Worker（TypeScript）用整頁跳轉主導兩段 OAuth、把對應寫進 D1（SQLite），並以伺服器端渲染提供 NYCU 白名單管理後台。session 以簽章 cookie 無狀態保存，對 Worker 網域為第一方，避開第三方 cookie 封鎖。

**Tech Stack:** TypeScript、Cloudflare Workers、D1、Wrangler、Vitest（`@cloudflare/vitest-pool-workers`）、Web Crypto（HMAC-SHA256）。

設計來源：[../specs/2026-06-16-nycu-github-account-mapping-design.md](../specs/2026-06-16-nycu-github-account-mapping-design.md)

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts` | 專案設定與部署 |
| `migrations/0001_init.sql` | D1 schema |
| `src/env.ts` | `Env` 型別、`isAdmin()`、`nycuConfig()` |
| `src/util.ts` | `randomState()` |
| `src/session.ts` | 簽章 session cookie：sign/verify、cookie 讀寫 |
| `src/csv.ts` | `BindingRow` 型別、`toCsv()` |
| `src/db/bindings.ts` | D1 存取：upsert/list/delete、`GithubConflictError` |
| `src/oauth/github.ts` | GitHub authorize URL、token 交換、取使用者 |
| `src/oauth/nycu.ts` | NYCU authorize URL、token 交換、取使用者（端點來自 env） |
| `src/html.ts` | 管理後台 HTML（含跳脫） |
| `src/index.ts` | 路由 + 所有 handler |
| `index.html`, `done.html` | github.io 靜態前端 |
| `test/*.test.ts` | 單元 + 整合測試 |
| `README.md` | 部署與營運步驟 |

---

## Task 1: 專案骨架

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`, `migrations/0001_init.sql`, `test/env.d.ts`, `.gitignore`

- [ ] **Step 1: 建立 `package.json`**

```json
{
  "name": "maccount-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20241106.0",
    "typescript": "^5.6.0",
    "vitest": "~2.1.0",
    "wrangler": "^3.84.0"
  }
}
```

- [ ] **Step 2: 建立 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: 建立 `wrangler.toml`**（`<...>` 於部署時填入，見 README）

```toml
name = "maccount-api"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[[d1_databases]]
binding = "DB"
database_name = "maccount"
database_id = "<filled-after-d1-create>"

[[migrations]]
# 由 wrangler 讀取 migrations/ 目錄

[vars]
PUBLIC_BASE_URL = "https://maccount-api.<subdomain>.workers.dev"
FRONTEND_DONE_URL = "https://skhuang.github.io/maccount/done.html"
NYCU_AUTHORIZE_URL = "https://id.nycu.edu.tw/o/authorize/"
NYCU_TOKEN_URL = "https://id.nycu.edu.tw/o/token/"
NYCU_USERINFO_URL = "https://id.nycu.edu.tw/o/userinfo/"
NYCU_SCOPE = "openid profile"
GITHUB_CLIENT_ID = ""
NYCU_CLIENT_ID = ""
ADMIN_IDS = ""
```

> 註：NYCU 端點 URL 為佔位，實作上線前以 NYCU 提供的實際 authorize/token/userinfo URL 取代（只改 `wrangler.toml`）。

- [ ] **Step 4: 建立 `migrations/0001_init.sql`**

```sql
CREATE TABLE bindings (
  nycu_id      TEXT PRIMARY KEY,
  nycu_name    TEXT,
  github_id    INTEGER UNIQUE,
  github_login TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

- [ ] **Step 5: 建立 `vitest.config.ts`**

```ts
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    test: {
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
          wrangler: { configPath: "./wrangler.toml" },
        },
      },
    },
  };
});
```

- [ ] **Step 6: 建立 `test/env.d.ts`**

```ts
import type { D1Migration } from "@cloudflare/workers-types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [ ] **Step 7: 建立 `.gitignore`**

```
node_modules/
.wrangler/
dist/
*.log
```

- [ ] **Step 8: 安裝相依並確認 TypeScript 可編譯**

Run: `npm install && npx tsc --noEmit`
Expected: 安裝成功；`tsc` 因為 `src/` 尚無檔案而通過（或無輸出）。

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json wrangler.toml vitest.config.ts migrations test/env.d.ts .gitignore package-lock.json
git commit -m "chore: scaffold Cloudflare Worker project (TS + D1 + vitest)"
```

---

## Task 2: session.ts + util.ts（簽章 session 與 state）

**Files:**
- Create: `src/util.ts`, `src/session.ts`, `test/session.test.ts`

- [ ] **Step 1: 寫失敗測試 `test/session.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession, type SessionData } from "../src/session";
import { randomState } from "../src/util";

const SECRET = "test-secret";

describe("session", () => {
  it("round-trips a signed session", async () => {
    const data: SessionData = { exp: Date.now() + 60000, purpose: "bind", nstate: "abc" };
    const token = await signSession(data, SECRET);
    const out = await verifySession(token, SECRET, Date.now());
    expect(out).toEqual(data);
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession({ exp: Date.now() + 60000 }, SECRET);
    const tampered = "x" + token.slice(1);
    expect(await verifySession(tampered, SECRET, Date.now())).toBeNull();
  });

  it("rejects an expired session", async () => {
    const token = await signSession({ exp: Date.now() - 1 }, SECRET);
    expect(await verifySession(token, SECRET, Date.now())).toBeNull();
  });

  it("rejects wrong secret", async () => {
    const token = await signSession({ exp: Date.now() + 60000 }, SECRET);
    expect(await verifySession(token, "other", Date.now())).toBeNull();
  });
});

describe("randomState", () => {
  it("returns 32 hex chars and varies", () => {
    const a = randomState();
    const b = randomState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL（找不到 `../src/session` / `../src/util`）。

- [ ] **Step 3: 實作 `src/util.ts`**

```ts
export function randomState(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: 實作 `src/session.ts`**

```ts
export interface SessionData {
  exp: number;
  purpose?: "bind" | "admin";
  nstate?: string;
  gstate?: string;
  nycu?: { id: string; name: string };
  admin?: boolean;
}

export const SESSION_COOKIE = "maccount_session";
const TTL_SECONDS = 900;
const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(data: SessionData, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const payload = b64urlEncode(enc.encode(JSON.stringify(data)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${payload}.${b64urlEncode(sig)}`;
}

export async function verifySession(
  token: string | null,
  secret: string,
  now: number,
): Promise<SessionData | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  const key = await hmacKey(secret);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(sigPart), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  let data: SessionData;
  try {
    data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
  if (typeof data.exp !== "number" || data.exp < now) return null;
  return data;
}

export function setCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(req: Request): string | null {
  const h = req.headers.get("Cookie");
  if (!h) return null;
  for (const part of h.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/session.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 6: Commit**

```bash
git add src/util.ts src/session.ts test/session.test.ts
git commit -m "feat: signed session cookie + random state"
```

---

## Task 3: csv.ts（對應表序列化）

**Files:**
- Create: `src/csv.ts`, `test/csv.test.ts`

- [ ] **Step 1: 寫失敗測試 `test/csv.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toCsv, type BindingRow } from "../src/csv";

const row: BindingRow = {
  nycu_id: "0856001",
  nycu_name: "王小明",
  github_id: 12345,
  github_login: "xiaoming",
  created_at: "2026-06-16T00:00:00.000Z",
  updated_at: "2026-06-16T00:00:00.000Z",
};

describe("toCsv", () => {
  it("emits header + row", () => {
    const csv = toCsv([row]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("nycu_id,nycu_name,github_id,github_login,created_at,updated_at");
    expect(lines[1]).toBe("0856001,王小明,12345,xiaoming,2026-06-16T00:00:00.000Z,2026-06-16T00:00:00.000Z");
  });

  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv([{ ...row, nycu_name: 'a,"b"\nc' }]);
    expect(csv).toContain('"a,""b""\nc"');
  });

  it("renders null fields as empty", () => {
    const csv = toCsv([{ ...row, nycu_name: null, github_login: null }]);
    const cells = csv.trimEnd().split("\n")[1].split(",");
    expect(cells[1]).toBe("");
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/csv.test.ts`
Expected: FAIL（找不到 `../src/csv`）。

- [ ] **Step 3: 實作 `src/csv.ts`**

```ts
export interface BindingRow {
  nycu_id: string;
  nycu_name: string | null;
  github_id: number;
  github_login: string | null;
  created_at: string;
  updated_at: string;
}

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: BindingRow[]): string {
  const header = ["nycu_id", "nycu_name", "github_id", "github_login", "created_at", "updated_at"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.nycu_id, r.nycu_name, r.github_id, r.github_login, r.created_at, r.updated_at]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/csv.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/csv.ts test/csv.test.ts
git commit -m "feat: CSV serialization for bindings"
```

---

## Task 4: db/bindings.ts（D1 存取與衝突處理）

**Files:**
- Create: `src/db/bindings.ts`, `test/bindings.test.ts`

- [ ] **Step 1: 寫失敗測試 `test/bindings.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  upsertBinding,
  listBindings,
  deleteBinding,
  GithubConflictError,
} from "../src/db/bindings";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM bindings").run();
});

const base = {
  nycu_id: "0856001",
  nycu_name: "王小明",
  github_id: 111,
  github_login: "ming",
  now: "2026-06-16T00:00:00.000Z",
};

describe("bindings", () => {
  it("inserts then lists", async () => {
    await upsertBinding(env.DB, base);
    const rows = await listBindings(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].github_login).toBe("ming");
  });

  it("re-binding the same nycu_id updates github fields", async () => {
    await upsertBinding(env.DB, base);
    await upsertBinding(env.DB, { ...base, github_id: 222, github_login: "ming2", now: "2026-06-17T00:00:00.000Z" });
    const rows = await listBindings(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].github_id).toBe(222);
    expect(rows[0].updated_at).toBe("2026-06-17T00:00:00.000Z");
  });

  it("throws GithubConflictError when github_id belongs to another nycu_id", async () => {
    await upsertBinding(env.DB, base);
    await expect(
      upsertBinding(env.DB, { ...base, nycu_id: "0856002", nycu_name: "李小華" }),
    ).rejects.toBeInstanceOf(GithubConflictError);
  });

  it("deletes a binding", async () => {
    await upsertBinding(env.DB, base);
    await deleteBinding(env.DB, base.nycu_id);
    expect(await listBindings(env.DB)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/bindings.test.ts`
Expected: FAIL（找不到 `../src/db/bindings`）。

- [ ] **Step 3: 實作 `src/db/bindings.ts`**

```ts
import type { BindingRow } from "../csv";

export class GithubConflictError extends Error {
  constructor(public existingNycuId: string) {
    super("github account already bound to another nycu account");
    this.name = "GithubConflictError";
  }
}

export interface UpsertInput {
  nycu_id: string;
  nycu_name: string;
  github_id: number;
  github_login: string;
  now: string;
}

export async function upsertBinding(db: D1Database, b: UpsertInput): Promise<void> {
  const existing = await db
    .prepare("SELECT nycu_id FROM bindings WHERE github_id = ?")
    .bind(b.github_id)
    .first<{ nycu_id: string }>();
  if (existing && existing.nycu_id !== b.nycu_id) {
    throw new GithubConflictError(existing.nycu_id);
  }
  await db
    .prepare(
      `INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(nycu_id) DO UPDATE SET
         nycu_name = ?2, github_id = ?3, github_login = ?4, updated_at = ?5`,
    )
    .bind(b.nycu_id, b.nycu_name, b.github_id, b.github_login, b.now)
    .run();
}

export async function listBindings(db: D1Database): Promise<BindingRow[]> {
  const { results } = await db
    .prepare(
      "SELECT nycu_id, nycu_name, github_id, github_login, created_at, updated_at FROM bindings ORDER BY created_at",
    )
    .all<BindingRow>();
  return results ?? [];
}

export async function deleteBinding(db: D1Database, nycu_id: string): Promise<void> {
  await db.prepare("DELETE FROM bindings WHERE nycu_id = ?").bind(nycu_id).run();
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/bindings.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/db/bindings.ts test/bindings.test.ts
git commit -m "feat: D1 bindings repository with github conflict guard"
```

---

## Task 5: env.ts（型別與 helper）+ oauth 模組

**Files:**
- Create: `src/env.ts`, `src/oauth/github.ts`, `src/oauth/nycu.ts`, `test/oauth.test.ts`

- [ ] **Step 1: 寫失敗測試 `test/oauth.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { githubAuthorizeUrl, exchangeGithubCode, fetchGithubUser } from "../src/oauth/github";
import { nycuAuthorizeUrl, exchangeNycuCode, fetchNycuUser, type NycuConfig } from "../src/oauth/nycu";
import { isAdmin } from "../src/env";

const nycuCfg: NycuConfig = {
  authorizeUrl: "https://id.nycu.edu.tw/o/authorize/",
  tokenUrl: "https://id.nycu.edu.tw/o/token/",
  userinfoUrl: "https://id.nycu.edu.tw/o/userinfo/",
  clientId: "ncid",
  clientSecret: "nsecret",
  scope: "openid profile",
};

function jsonFetcher(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("github oauth", () => {
  it("builds authorize url with read:user scope", () => {
    const u = new URL(githubAuthorizeUrl("cid", "https://api.example/cb", "st8"));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("scope")).toBe("read:user");
    expect(u.searchParams.get("state")).toBe("st8");
  });

  it("exchanges code for token", async () => {
    const token = await exchangeGithubCode(
      { clientId: "c", clientSecret: "s", code: "x", redirectUri: "https://api/cb" },
      jsonFetcher({ access_token: "gh_tok" }),
    );
    expect(token).toBe("gh_tok");
  });

  it("fetches github user id + login", async () => {
    const user = await fetchGithubUser("gh_tok", jsonFetcher({ id: 42, login: "octo" }));
    expect(user).toEqual({ id: 42, login: "octo" });
  });
});

describe("nycu oauth", () => {
  it("builds authorize url", () => {
    const u = new URL(nycuAuthorizeUrl(nycuCfg, "https://api/cb", "st8"));
    expect(u.origin + u.pathname).toBe("https://id.nycu.edu.tw/o/authorize/");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid profile");
  });

  it("exchanges code for token", async () => {
    const token = await exchangeNycuCode(nycuCfg, "x", "https://api/cb", jsonFetcher({ access_token: "n_tok" }));
    expect(token).toBe("n_tok");
  });

  it("maps userinfo claims to id + name", async () => {
    const user = await fetchNycuUser(nycuCfg, "n_tok", jsonFetcher({ username: "0856001", name: "王小明" }));
    expect(user).toEqual({ id: "0856001", name: "王小明" });
  });
});

describe("isAdmin", () => {
  it("matches a comma-separated allowlist", () => {
    const env = { ADMIN_IDS: "0856001, admin2 " } as any;
    expect(isAdmin(env, "0856001")).toBe(true);
    expect(isAdmin(env, "admin2")).toBe(true);
    expect(isAdmin(env, "nope")).toBe(false);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/oauth.test.ts`
Expected: FAIL（找不到模組）。

- [ ] **Step 3: 實作 `src/oauth/github.ts`**

```ts
export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "read:user");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeGithubCode(
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const res = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`github token exchange: ${data.error ?? "no token"}`);
  return data.access_token;
}

export async function fetchGithubUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ id: number; login: string }> {
  const res = await fetcher("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "maccount",
    },
  });
  if (!res.ok) throw new Error(`github user fetch failed: ${res.status}`);
  const data = (await res.json()) as { id: number; login: string };
  return { id: data.id, login: data.login };
}
```

- [ ] **Step 4: 實作 `src/oauth/nycu.ts`**

```ts
export interface NycuConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export function nycuAuthorizeUrl(cfg: NycuConfig, redirectUri: string, state: string): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeNycuCode(
  cfg: NycuConfig,
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetcher(cfg.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`nycu token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("nycu token exchange: no token");
  return data.access_token;
}

export async function fetchNycuUser(
  cfg: NycuConfig,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; name: string }> {
  const res = await fetcher(cfg.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`nycu userinfo failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  // NYCU claim 名稱待與 NYCU 確認；此處集中映射，上線前若不同只改這幾行。
  const id = String(data.username ?? data.sub ?? data.id ?? "");
  const name = String(data.name ?? data.displayName ?? id);
  if (!id) throw new Error("nycu userinfo: missing id claim");
  return { id, name };
}
```

- [ ] **Step 5: 實作 `src/env.ts`**

```ts
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
```

- [ ] **Step 6: 執行測試確認通過**

Run: `npx vitest run test/oauth.test.ts`
Expected: PASS（8 tests）。

- [ ] **Step 7: Commit**

```bash
git add src/env.ts src/oauth/github.ts src/oauth/nycu.ts test/oauth.test.ts
git commit -m "feat: OAuth modules for NYCU and GitHub + env helpers"
```

---

## Task 6: html.ts（管理後台頁面，含 XSS 跳脫）

**Files:**
- Create: `src/html.ts`, `test/html.test.ts`

- [ ] **Step 1: 寫失敗測試 `test/html.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { adminPage } from "../src/html";
import type { BindingRow } from "../src/csv";

const rows: BindingRow[] = [
  {
    nycu_id: "0856001",
    nycu_name: "<script>x</script>",
    github_id: 42,
    github_login: "octo",
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
  },
];

describe("adminPage", () => {
  it("shows the count and an export link", () => {
    const html = adminPage(rows);
    expect(html).toContain("(1)");
    expect(html).toContain('href="/admin/export.csv"');
  });

  it("escapes HTML in user-controlled fields", () => {
    const html = adminPage(rows);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("renders a delete form per row", () => {
    const html = adminPage(rows);
    expect(html).toContain('action="/admin/delete"');
    expect(html).toContain('name="nycu_id" value="0856001"');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/html.test.ts`
Expected: FAIL（找不到 `../src/html`）。

- [ ] **Step 3: 實作 `src/html.ts`**

```ts
import type { BindingRow } from "./csv";

function h(v: unknown): string {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function adminPage(rows: BindingRow[]): string {
  const trs = rows
    .map(
      (r) => `<tr>
  <td>${h(r.nycu_id)}</td><td>${h(r.nycu_name)}</td>
  <td>${h(r.github_login)}</td><td>${h(r.github_id)}</td>
  <td>${h(r.updated_at)}</td>
  <td><form method="post" action="/admin/delete" onsubmit="return confirm('刪除 ${h(r.nycu_id)} 的綁定？')">
    <input type="hidden" name="nycu_id" value="${h(r.nycu_id)}"><button type="submit">刪除</button></form></td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<title>maccount 管理</title>
<body style="font-family:system-ui;max-width:900px;margin:2rem auto">
<h1>綁定名單 (${rows.length})</h1>
<p><a href="/admin/export.csv">⬇ 匯出 CSV</a></p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>姓名</th><th>GitHub</th><th>GitHub id</th><th>更新時間</th><th></th></tr></thead>
<tbody>
${trs}
</tbody></table>
</body></html>`;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/html.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/html.ts test/html.test.ts
git commit -m "feat: admin page renderer with HTML escaping"
```

---

## Task 7: index.ts（路由 + handlers）與整合測試

**Files:**
- Create: `src/index.ts`, `test/worker.test.ts`

- [ ] **Step 1: 寫失敗整合測試 `test/worker.test.ts`**

```ts
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
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM bindings").run();
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

describe("/auth/github/callback (bind happy path)", () => {
  it("upserts a binding and redirects to done?status=ok", async () => {
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
      { exp: Date.now() + 60000, purpose: "bind", nycu: { id: "0856001", name: "王小明" }, gstate: "GS" },
      SECRET,
    );
    const res = await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://skhuang.github.io/maccount/done.html?status=ok",
    );
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
      { exp: Date.now() + 60000, purpose: "bind", nycu: { id: "0856001", name: "王" }, gstate: "GS" },
      SECRET,
    );
    const res = await call("/auth/github/callback?code=abc&state=GS", { headers: cookie(session) });
    expect(res.headers.get("Location")).toContain("status=err");
    expect(res.headers.get("Location")).toContain("reason=github_already_bound");
  });

  it("rejects a state mismatch", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, purpose: "bind", nycu: { id: "x", name: "x" }, gstate: "GS" },
      SECRET,
    );
    const res = await call("/auth/github/callback?code=abc&state=WRONG", { headers: cookie(session) });
    expect(res.status).toBe(400);
  });
});

describe("/admin auth gate", () => {
  it("redirects anonymous users to admin login", async () => {
    const res = await call("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/nycu/start?purpose=admin");
  });

  it("serves the list to an admin session", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, admin: true, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/admin", { headers: cookie(session) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("綁定名單");
  });

  it("exports CSV to an admin session", async () => {
    const session = await signSession(
      { exp: Date.now() + 60000, admin: true, nycu: { id: "admin1", name: "Admin" } },
      SECRET,
    );
    const res = await call("/admin/export.csv", { headers: cookie(session) });
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(await res.text()).toContain("nycu_id,nycu_name");
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/worker.test.ts`
Expected: FAIL（找不到 `../src/index`）。

- [ ] **Step 3: 實作 `src/index.ts`**

```ts
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
import { upsertBinding, listBindings, deleteBinding, GithubConflictError } from "./db/bindings";
import { toCsv } from "./csv";
import { adminPage } from "./html";

const TTL_MS = 15 * 60 * 1000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/auth/nycu/start") return await startNycu(req, env, url);
      if (p === "/auth/nycu/callback") return await nycuCallback(req, env, url);
      if (p === "/auth/github/callback") return await githubCallback(req, env, url);
      if (p === "/admin" && req.method === "GET") return await adminList(req, env);
      if (p === "/admin/export.csv") return await adminExport(req, env);
      if (p === "/admin/delete" && req.method === "POST") return await adminDelete(req, env);
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return new Response(`Error: ${(e as Error).message}`, { status: 500 });
    }
  },
};

function redirect(location: string, cookie?: string): Response {
  const headers: Record<string, string> = { Location: location };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

async function startNycu(req: Request, env: Env, url: URL): Promise<Response> {
  const purpose = url.searchParams.get("purpose") === "admin" ? "admin" : "bind";
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

async function adminDelete(req: Request, env: Env): Promise<Response> {
  const s = await requireAdmin(req, env);
  if (s instanceof Response) return s;
  const form = await req.formData();
  const nycuId = String(form.get("nycu_id") ?? "");
  if (nycuId) await deleteBinding(env.DB, nycuId);
  return redirect("/admin");
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/worker.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 5: 跑完整測試套件 + 型別檢查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS、`tsc` 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/worker.test.ts
git commit -m "feat: worker router with OAuth flow and admin endpoints"
```

---

## Task 8: 靜態前端（github.io 入口/結果頁）

**Files:**
- Create: `index.html`, `done.html`

- [ ] **Step 1: 建立 `index.html`**

```html
<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NYCU × GitHub 帳號綁定</title>
<body style="font-family:system-ui;max-width:640px;margin:3rem auto;padding:0 1rem;line-height:1.6">
  <h1>NYCU × GitHub 帳號綁定</h1>
  <p>請依序完成兩個登入：先用 <b>NYCU 帳號 (id.nycu.edu.tw)</b> 確認身分，再授權你的 <b>GitHub</b> 帳號。完成後系統會記錄兩者的對應。</p>
  <p><a id="start" style="display:inline-block;padding:.7rem 1.4rem;background:#0b5;color:#fff;border-radius:8px;text-decoration:none">開始綁定 →</a></p>
  <script>
    // 部署後把這裡換成你的 Worker 網址
    const WORKER_BASE = "https://maccount-api.<subdomain>.workers.dev";
    document.getElementById("start").href = WORKER_BASE + "/auth/nycu/start";
  </script>
</body>
</html>
```

- [ ] **Step 2: 建立 `done.html`**

```html
<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>綁定結果</title>
<body style="font-family:system-ui;max-width:640px;margin:3rem auto;padding:0 1rem;line-height:1.6">
  <h1 id="title">處理中…</h1>
  <p id="msg"></p>
  <p><a href="./">回首頁</a></p>
  <script>
    const q = new URLSearchParams(location.search);
    const status = q.get("status");
    const reason = q.get("reason");
    const title = document.getElementById("title");
    const msg = document.getElementById("msg");
    if (status === "ok") {
      title.textContent = "✅ 綁定成功";
      msg.textContent = "你的 NYCU 與 GitHub 帳號已建立對應。";
    } else {
      title.textContent = "⚠️ 綁定未完成";
      msg.textContent =
        reason === "github_already_bound"
          ? "這個 GitHub 帳號已被其他 NYCU 帳號綁定，請聯絡管理員。"
          : "發生錯誤，請回首頁重試。";
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add index.html done.html
git commit -m "feat: static github.io frontend (entry + result pages)"
```

---

## Task 9: README 與部署/營運說明

**Files:**
- Create: `README.md`

- [ ] **Step 1: 建立 `README.md`**

````markdown
# maccount — NYCU ↔ GitHub 帳號對應服務

前端（靜態）部署於 `skhuang.github.io/maccount`；後端為 Cloudflare Worker (TypeScript) + D1。
設計與計畫見 `docs/superpowers/`。

## 開發

```bash
npm install
npm test          # 跑所有 vitest 測試
npm run dev       # 本機 wrangler dev
```

## 部署步驟

### 1. 建立 D1 並套用 schema
```bash
npx wrangler d1 create maccount
# 把輸出的 database_id 填進 wrangler.toml 的 [[d1_databases]]
npx wrangler d1 migrations apply maccount --remote
```

### 2. 註冊 OAuth app
- **GitHub**：Settings → Developer settings → OAuth Apps → New。
  Authorization callback URL = `https://<worker>/auth/github/callback`。
  取得 Client ID / Client secret。
- **NYCU**：向 `id.nycu.edu.tw` 申請 client，登記 callback `https://<worker>/auth/nycu/callback`。
  取得 client id/secret 與實際 authorize/token/userinfo 端點 → 填入 `wrangler.toml` 的 `NYCU_*` vars。
  若 userinfo 的 claim 名稱與預設不同，調整 `src/oauth/nycu.ts` 的 `fetchNycuUser` 映射。

### 3. 設定 vars 與 secrets
編輯 `wrangler.toml` 的 `[vars]`（`PUBLIC_BASE_URL`、`FRONTEND_DONE_URL`、`GITHUB_CLIENT_ID`、`NYCU_CLIENT_ID`、`ADMIN_IDS` 以逗號分隔的 NYCU 帳號）。
secrets 用指令設定（不進版控）：
```bash
npx wrangler secret put SESSION_SECRET        # 隨機長字串
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put NYCU_CLIENT_SECRET
```

### 4. 部署 Worker
```bash
npx wrangler deploy
```
部署後把 `index.html` 內的 `WORKER_BASE` 換成實際 Worker 網址。

### 5. 啟用 GitHub Pages
repo Settings → Pages → 由 `main` 分支根目錄發佈 → 服務在 `https://skhuang.github.io/maccount/`。

## 使用
- 學生：開 `https://skhuang.github.io/maccount/` → 開始綁定。
- 管理員（`ADMIN_IDS` 內的 NYCU 帳號）：開 `https://<worker>/admin` → 用 NYCU 登入 → 看名單 / 匯出 CSV / 刪除綁定。
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: deployment and operations README"
```

---

## Self-Review 結果（已對照 spec）

- **Spec 覆蓋**：§3 元件→Task 1/7/8；§4 綁定流程→Task 7（`startNycu`/`nycuCallback`/`githubCallback`）；§5 資料模型→Task 1/4；§6 管理介面→Task 6/7；§7 安全（state、簽章 cookie、最小 scope、secrets、白名單）→Task 2/5/7；§8 前置條件→Task 9 README。
- **無 placeholder**：所有程式步驟皆附完整程式碼；`<...>` 僅出現在部署時填值處且 README 說明如何填。
- **型別一致**：`SessionData`、`Env`、`BindingRow`、`NycuConfig`、`upsertBinding`/`listBindings`/`deleteBinding`、`GithubConflictError`、`adminPage`、`toCsv` 在定義與使用處名稱一致。
- **已知外部不確定**：NYCU 端點與 claim 名稱集中於 `wrangler.toml` vars 與 `src/oauth/nycu.ts`，上線前一處修改即可。
