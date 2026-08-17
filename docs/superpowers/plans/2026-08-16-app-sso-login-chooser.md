# App-SSO Login Chooser (NYCU/GitHub/Google) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a relying app's (dsvisual's) not-logged-in SSO users pick NYCU, GitHub, or Google login, instead of being forced to NYCU.

**Architecture:** The `app_return` carry-forward already works for all three login methods (both `startNycu` and `startOAuthLogin` preserve it; all three callbacks consume it via `postLoginDestination`). The only NYCU-hardcoding is `startApp`'s not-logged-in branch redirecting to `/auth/nycu/start`. Replace that redirect with a worker-served chooser page (still stashing `app_return` in the pre-login cookie first) whose three buttons link to the existing same-origin login routes. A small dsvisual copy tweak makes the sign-in label method-neutral.

**Tech Stack:** Cloudflare Worker (TypeScript), D1; vitest (`cloudflare:test`, `worker.fetch`, `vi.stubGlobal`); maccount UI helpers (`src/ui/layout.ts` `documentStart`, `src/ui/components.ts` `h` for HTML-escape), i18n (`src/i18n.ts` `pickLang`/`langCookie`/`T`). dsvisual: vanilla-JS `js/i18n.js`.

## Global Constraints

- Task 1 is in the **maccount** repo (`/Users/skhuang/course/maccount`, branch `feat/app-sso-login-chooser`). Task 2 is in the **dsvisual** repo (`/Users/skhuang/course/dsvisual`, its own branch).
- `startApp` (`src/index.ts:268-283`): keep the `allowedReturn` 400 guard and the logged-in branch (`appTokenRedirect`) UNCHANGED. Only the **not-logged-in branch** changes: still build the pre-login session `{ exp, app_return:{app,return} }`, `signSession`, and set the session cookie — but return the chooser page (200 HTML) instead of a 302 to `/auth/nycu/start`.
- The chooser response MUST set two cookies via `headers.append("Set-Cookie", …)`: the session cookie (carries `app_return` — required) and `langCookie(lang)`.
- Chooser buttons link to the existing same-origin routes, each carrying `?lang=<lang>`: `/auth/nycu/start`, `/auth/github/login`, `/auth/google/login`. Do NOT add any `app`/`return` query params to them (the cookie carries `app_return`).
- HTML-escape any interpolated `appId` with `h()` from `src/ui/components.ts`.
- Use `pickLang(url, req.headers.get("Cookie"))` for language; render via `documentStart(lang, title, css)` + `</body></html>`.
- Do NOT change `appTokenRedirect`, `postLoginDestination`, `/api/app/verify`, or any existing OAuth/bind/login/`/me`/admin behavior.
- maccount tests: `npm test` (vitest). dsvisual tests: `npm run test:all` (unit deterministic; Playwright may flake under load — re-run a failing spec in isolation).
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: maccount — login chooser page + `startApp` change + i18n + tests

**Files:**
- Create: `src/ui/app_login.ts` (`appLoginChooserPage`)
- Modify: `src/index.ts` (`startApp` not-logged-in branch)
- Modify: `src/i18n.ts` (`appLogin.*` strings, zh + en; type if `Strings` is a fixed interface)
- Test: `test/app_start.test.ts` (update NYCU-only assertion), `test/app_sso_flow.test.ts` (update + add GitHub end-to-end), `test/ui/app_login.test.ts` (new, render unit)

**Interfaces:**
- Consumes: `pickLang`, `langCookie` (`src/i18n.ts`); `documentStart` (`src/ui/layout.ts`); `h` (`src/ui/components.ts`); existing `signSession`, `setCookie`, `SessionData`, `TTL_MS` in `src/index.ts`.
- Produces: `appLoginChooserPage(lang: Lang, appId: string): string` (exported from `src/ui/app_login.ts`) — full HTML document string containing three anchor links to `/auth/nycu/start?lang=…`, `/auth/github/login?lang=…`, `/auth/google/login?lang=…`.

- [ ] **Step 1: Write the render unit test (failing)**

```ts
// test/ui/app_login.test.ts
import { describe, it, expect } from "vitest";
import { appLoginChooserPage } from "../../src/ui/app_login";

describe("appLoginChooserPage", () => {
  it("renders three login links carrying lang, escapes appId", () => {
    const html = appLoginChooserPage("en", "dsvisual");
    expect(html).toContain('href="/auth/nycu/start?lang=en"');
    expect(html).toContain('href="/auth/github/login?lang=en"');
    expect(html).toContain('href="/auth/google/login?lang=en"');
    expect(html).toContain("dsvisual");
  });
  it("html-escapes a hostile appId", () => {
    const html = appLoginChooserPage("en", '<script>x</script>');
    expect(html).not.toContain("<script>x</script>");
  });
  it("renders zh labels when lang=zh", () => {
    const html = appLoginChooserPage("zh", "dsvisual");
    expect(html).toContain("用 GitHub 登入");
    expect(html).toContain("用 Google 登入");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`appLoginChooserPage` doesn't exist). Run: `npx vitest run test/ui/app_login.test.ts`

- [ ] **Step 3: Implement the render + i18n**

Add `appLogin.*` keys to BOTH `zh` and `en` blocks of `T` in `src/i18n.ts` (if `Strings` is a fixed interface, add the fields to it too):

```ts
// en
"appLogin.title": "Sign in to maccount",
"appLogin.subtitle": "Sign in to continue to {app}",
"appLogin.nycu": "Sign in with NYCU",
"appLogin.github": "Sign in with GitHub",
"appLogin.google": "Sign in with Google",
"appLogin.note": "GitHub / Google must be an account already linked in maccount.",
// zh
"appLogin.title": "登入 maccount",
"appLogin.subtitle": "登入以繼續使用 {app}",
"appLogin.nycu": "以 NYCU 帳號登入",
"appLogin.github": "用 GitHub 登入",
"appLogin.google": "用 Google 登入",
"appLogin.note": "GitHub / Google 需為已在 maccount 綁定過的帳號。",
```

Create `src/ui/app_login.ts` (match the existing `T` access pattern in the repo — if strings are read as `T[lang]["appLogin.title"]`, use that; the snippet below assumes `T[lang]` is a record keyed by string):

```ts
import type { Lang } from "../i18n";
import { T } from "../i18n";
import { documentStart } from "./layout";
import { h } from "./components";

export function appLoginChooserPage(lang: Lang, appId: string): string {
  const t = (k: string) => (T[lang] as Record<string, string>)[k] ?? k;
  const app = h(appId);
  const subtitle = t("appLogin.subtitle").replace("{app}", app);
  const link = (href: string, label: string) =>
    `<a class="btn" href="${href}">${label}</a>`;
  const q = `?lang=${lang}`;
  return (
    documentStart(lang, t("appLogin.title"), "") +
    `<main class="card app-login">` +
    `<h1>${t("appLogin.title")}</h1>` +
    `<p>${subtitle}</p>` +
    `<div class="app-login-methods">` +
    link(`/auth/nycu/start${q}`, t("appLogin.nycu")) +
    link(`/auth/github/login${q}`, t("appLogin.github")) +
    link(`/auth/google/login${q}`, t("appLogin.google")) +
    `</div>` +
    `<p class="muted">${t("appLogin.note")}</p>` +
    `</main></body></html>`
  );
}
```

> Note for the implementer: confirm how strings are actually accessed in this repo (`T[lang]["appLogin.title"]` vs a typed `Strings` object with dotted keys vs nested). Match the existing convention; keep the three `href` values and the `?lang=` exactly as the tests assert. Reuse whatever card/btn CSS classes existing pages use (no new stylesheet).

- [ ] **Step 4: Change `startApp`'s not-logged-in branch** (`src/index.ts`)

Replace the not-logged-in tail of `startApp` (currently builds `pre`, signs, and 302s to `/auth/nycu/start`) with:

```ts
  // not logged in: stash app_return in a pre-login session, then show the
  // login-method chooser (NYCU / GitHub / Google). The chooser's buttons hit
  // same-origin login routes, so this cookie (and its app_return) rides along
  // and every callback returns to the app with an #mtoken.
  const pre: SessionData = { exp: Date.now() + TTL_MS, app_return: { app, return: ret } };
  const token = await signSession(pre, env.SESSION_SECRET);
  const lang = pickLang(url, req.headers.get("Cookie"));
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  headers.append("Set-Cookie", setCookie(token));
  headers.append("Set-Cookie", langCookie(lang));
  return new Response(appLoginChooserPage(lang, app), { status: 200, headers });
```

Add imports at the top of `src/index.ts` if not already present: `appLoginChooserPage` from `./ui/app_login`, and ensure `pickLang`/`langCookie` are imported from `./i18n` (they are used elsewhere in the file — reuse the existing import).

- [ ] **Step 5: Update `test/app_start.test.ts`** — the not-logged-in case now returns the chooser:

```ts
  it("not logged in -> renders the login chooser and stashes app_return", async () => {
    const env = await makeEnv();
    const r = await worker.fetch(new Request(
      "https://x/auth/app/start?app=dsvisual&return=https://skhuang.github.io/dsvisual/"), env);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('href="/auth/nycu/start');
    expect(body).toContain('href="/auth/github/login');
    expect(body).toContain('href="/auth/google/login');
    const sc = r.headers.get("Set-Cookie")!;
    expect(sc).toContain("maccount_session");
    // the stashed pre-login session carries app_return
    const { verifySession } = await import("../src/session");
    const m = sc.match(/maccount_session=([^;]+)/)!;
    const s = await verifySession(m[1], env.SESSION_SECRET, Date.now());
    expect(s?.app_return).toMatchObject({ app: "dsvisual" });
  });
```

(Keep the logged-in and 400 cases unchanged; adjust only the NYCU-redirect assertion.)

- [ ] **Step 6: Update `test/app_sso_flow.test.ts`** — the not-logged-in step now lands on the chooser, and add a GitHub end-to-end.

- Change the existing NYCU flow's Step-1 assertion from `302 → /auth/nycu/start` to: `r1.status === 200`, body contains the three login links, and (as today) the Set-Cookie session carries `app_return`. Then continue the NYCU path by calling `/auth/nycu/start` directly with that cookie (the button's href) before the existing `/auth/nycu/callback` step — the rest of the assertions (mtoken back, `verifyAppToken`) stay.
- Add a new `it(...)` that walks the **GitHub** alternate-login path end to end, mirroring the NYCU flow test's structure and the GitHub-login callback pattern in `test/oauth.test.ts` (seed a binding in D1 for the GitHub identity so the reverse-lookup succeeds; `vi.stubGlobal("fetch", …)` to fake GitHub's token + user API): `/auth/app/start` (no session) → take the pre-login cookie → `GET /auth/github/login` (carries cookie) → `GET /auth/github/callback?...` (stubbed) → assert `302` to `<return>#mtoken=…` and `verifyAppToken` yields the bound `sub`/`aud:"dsvisual"`. Google shares the same `startOAuthLogin`/login-branch callback path; a comment should note that. (If seeding/stubbing GitHub proves heavy, at minimum assert that `GET /auth/github/login` with the pre-login cookie preserves `app_return` into its state session — but prefer the full end-to-end.)

- [ ] **Step 7: Run all maccount tests — expect PASS.** Run: `npm test`
Expected: new render unit + updated app_start + updated/added flow tests pass; full vitest suite green.

- [ ] **Step 8: Commit**

```bash
git add src/ui/app_login.ts src/index.ts src/i18n.ts test/ui/app_login.test.ts test/app_start.test.ts test/app_sso_flow.test.ts
git commit -m "feat(auth): app-SSO login chooser (NYCU/GitHub/Google)"
```

---

### Task 2: dsvisual — method-neutral sign-in copy

**Files:**
- Modify: `js/i18n.js` (`cloud.signin-cta`, `cloud.signin-note`)
- Test: existing `tests/cloud-drawer.spec.js` (adjust only if it asserts the old text)

**Interfaces:** none produced. Runs in the **dsvisual** repo (`/Users/skhuang/course/dsvisual`, branch off `main`).

- [ ] **Step 1: Check whether any test asserts the current copy**

Run (in dsvisual): `grep -rn "Sign in with NYCU\|以 NYCU 帳號登入\|signin-cta\|signin-note" tests/ js/i18n.js`
If `tests/cloud-drawer.spec.js` asserts the literal old label, note it — Step 3 updates it alongside the copy.

- [ ] **Step 2: Change the copy in `js/i18n.js`**

In the en block: `'cloud.signin-cta'` → `'Sign in'`; `'cloud.signin-note'` → `'Sign in with your NYCU, GitHub, or Google account (via maccount) to enable practice on dsjudge.'`
In the zh block: `'cloud.signin-cta'` → `'登入'`; `'cloud.signin-note'` → `'以你在 maccount 綁定的 NYCU、GitHub 或 Google 帳號登入,即可在 dsjudge 練習。'`
(Leave `lab.dsjudgeSignin` as-is — it's already method-neutral.)

- [ ] **Step 3: Update the drawer test if needed**

If `tests/cloud-drawer.spec.js` asserted the old CTA text, update that assertion to the new label (or to `data-testid`-based presence, not literal text). Otherwise no test change.

- [ ] **Step 4: Run the suite — expect PASS.** Run: `npm run test:all`

- [ ] **Step 5: Commit**

```bash
git add js/i18n.js tests/cloud-drawer.spec.js
git commit -m "feat(auth): method-neutral sign-in copy (chooser picks NYCU/GitHub/Google)"
```

---

## Final gate (after both tasks)

- [ ] maccount `npm test` green; dsvisual `npm run test:all` green.
- [ ] Manual/curl sanity after deploy: `GET /auth/app/start?app=dsvisual&return=<allowed>` returns 200 with the three login links; a non-allowlisted app still 400s.
- [ ] Open a PR to `main` in each repo.
- [ ] Deploy note: the chooser is live only after `npx wrangler deploy` (maccount); dsvisual copy after a Pages deploy. No new env/secret needed (`APP_ALLOWLIST`/`APP_TOKEN_SECRET` already set).
