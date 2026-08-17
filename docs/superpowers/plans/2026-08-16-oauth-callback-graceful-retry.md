# OAuth callback graceful-retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an OAuth callback state mismatch, bounce the user back to restart cleanly instead of dead-ending at a raw `400 Invalid … callback`.

**Architecture:** A shared `recoverLogin(env, session)` returns a friendly redirect — back to `/auth/app/start?app=&return=` when the (possibly stale) session still carries an `app_return` (the app-SSO case), otherwise to the done page with `reason=login_retry`. The three callbacks (`nycuCallback`/`githubCallback`/`googleCallback`) call it in place of the `400`. A state mismatch never completes a login, so CSRF protection is unchanged.

**Tech Stack:** Cloudflare Worker (TypeScript), D1; vitest (`cloudflare:test`, `worker.fetch`); existing helpers `redirect`, `redirectDone`, `allowedReturn`, `signSession`/`setCookie`, `SessionData`.

## Global Constraints

- maccount repo (`/Users/skhuang/course/maccount`, branch `fix/oauth-callback-graceful-retry`).
- Only the state-mismatch `400` branches change. Do NOT alter the success paths, the `oauthError` branches, code exchange, or any token/CORS/verify/`/me`/admin behavior.
- `recoverLogin` MUST NOT complete a login (no code exchange, no login session) — it only redirects. The `app_return` branch redirects to a same-origin relative path (`/auth/app/start`), guarded by `allowedReturn`; the fallback uses `redirectDone(env, "err", "login_retry")` (which clears the cookie).
- Run `npm test` (vitest) — full suite green; `npx tsc --noEmit` clean.
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `recoverLogin` helper + wire it into the three callbacks

**Files:**
- Modify: `src/index.ts` (add `recoverLogin`; replace the three `400` returns)
- Test: `test/oauth_recover.test.ts` (new)

**Interfaces:**
- Consumes: `redirect`, `redirectDone`, `allowedReturn` (imported at `src/index.ts:44`), `SessionData`, `signSession`/`setCookie` (for building test cookies).
- Produces: `recoverLogin(env: Env, session: SessionData | null): Response` — internal helper (not exported).

- [ ] **Step 1: Write the failing test**

```ts
// test/oauth_recover.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { signSession, setCookie, SESSION_COOKIE } from "../src/session";
import { makeEnv } from "./helpers_app_sso";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

const RETURN = "https://skhuang.github.io/dsvisual/";
async function cookieFor(testEnv: any, data: any): Promise<string> {
  return `${SESSION_COOKIE}=` + (setCookie(await signSession(data, testEnv.SESSION_SECRET)).match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]);
}

describe("OAuth callback graceful retry on state mismatch", () => {
  // The real failure case: the chooser cookie (has app_return, no gostate) is
  // sent to /auth/google/callback -> mismatch -> bounce back to the chooser.
  it("google: session has app_return but wrong/missing gostate -> 302 to /auth/app/start", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, app_return: { app: "dsvisual", return: RETURN } });
    const r = await worker.fetch(new Request(
      "https://api/auth/google/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    const loc = r.headers.get("Location")!;
    expect(loc).toContain("/auth/app/start?app=dsvisual");
    expect(loc).toContain("return=" + encodeURIComponent(RETURN));
  });

  it("github: app_return present, gstate mismatch -> 302 to /auth/app/start", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, gstate: "OTHER", app_return: { app: "dsvisual", return: RETURN } });
    const r = await worker.fetch(new Request(
      "https://api/auth/github/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")!).toContain("/auth/app/start?app=dsvisual");
  });

  it("nycu: app_return present, nstate mismatch -> 302 to /auth/app/start", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, nstate: "OTHER", app_return: { app: "dsvisual", return: RETURN } });
    const r = await worker.fetch(new Request(
      "https://api/auth/nycu/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")!).toContain("/auth/app/start?app=dsvisual");
  });

  it("no session / no app_return -> 302 to done page with reason=login_retry, not 400", async () => {
    const testEnv = await makeEnv();
    const r = await worker.fetch(new Request("https://api/auth/google/callback?state=STALE&code=abc"), testEnv);
    expect(r.status).toBe(302);
    const loc = r.headers.get("Location")!;
    expect(loc).toContain("status=err");
    expect(loc).toContain("reason=login_retry");
  });

  it("app_return present but NOT allowlisted -> falls back to done page (no open redirect)", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, app_return: { app: "dsvisual", return: "https://evil.example/" } });
    const r = await worker.fetch(new Request(
      "https://api/auth/google/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")!).toContain("reason=login_retry");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (current code returns 400). Run: `npx vitest run test/oauth_recover.test.ts`

- [ ] **Step 3: Add `recoverLogin`** near the other small helpers in `src/index.ts` (e.g. just after `redirectDone`):

```ts
// A benign callback-state mismatch (a stale or auto-initiated authorize, a lost
// state cookie, a double-submit, or Google silent `prompt=none` sign-in) should
// not dead-end at a 400. We never complete a login on a mismatched state, so
// CSRF protection is intact — this only replaces the raw 400 with a friendly
// path. If the (possibly stale) session still knows where the user was headed,
// bounce back to /auth/app/start to restart with a fresh state (the chooser is
// a 200, so there is no auto-redirect loop); otherwise go to the done page.
function recoverLogin(env: Env, session: SessionData | null): Response {
  const ar = session?.app_return;
  if (ar && allowedReturn(env, ar.app, ar.return)) {
    return redirect(
      `/auth/app/start?app=${encodeURIComponent(ar.app)}&return=${encodeURIComponent(ar.return)}`,
    );
  }
  return redirectDone(env, "err", "login_retry");
}
```

- [ ] **Step 4: Replace the three `400` returns** with `return recoverLogin(env, session);`:
- `src/index.ts` nycuCallback (`Invalid NYCU callback`), githubCallback (`Invalid GitHub callback`), googleCallback (`Invalid Google callback`). Leave each surrounding `if (…) { … }` condition and everything else unchanged — only the body's `return new Response(...)` line changes.

- [ ] **Step 5: Run — expect PASS**, then full suite. Run: `npx vitest run test/oauth_recover.test.ts` then `npm test` and `npx tsc --noEmit`.
Expected: new tests pass; existing suite green (success paths unchanged); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/oauth_recover.test.ts
git commit -m "fix(auth): graceful retry on OAuth callback state mismatch"
```

---

## Final gate (after the task)

- [ ] `npm test` green; `tsc --noEmit` clean.
- [ ] Grep: no remaining `Invalid NYCU callback` / `Invalid GitHub callback` / `Invalid Google callback` 400 responses; all three route through `recoverLogin`.
- [ ] curl sanity after deploy: send the chooser cookie to `/auth/google/callback?state=stale&code=x` → 302 to `/auth/app/start?app=dsvisual&return=…` (not 400).
- [ ] Open a PR to `main`. Deploy note: live after `npx wrangler deploy` (no new env/secret).
