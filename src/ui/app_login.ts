import type { Lang } from "../i18n";
import { T } from "../i18n";
import { documentStart } from "./layout";
import { h } from "./components";

// Login-method chooser shown to not-logged-in users hitting the relying-app
// SSO entry point (/auth/app/start). Each link is a same-origin login route
// (NYCU / GitHub / Google); the pre-login session cookie stashed by
// startApp (carrying app_return) rides along with the browser regardless of
// which method the user picks, so every callback still returns to the app.
export function appLoginChooserPage(lang: Lang, appId: string): string {
  const t = T[lang];
  const subtitle = t.appLoginSubtitle.replace("{app}", h(appId));
  const q = `?lang=${lang}`;
  const link = (href: string, label: string) => `<a class="btn" href="${href}">${h(label)}</a>`;
  return (
    documentStart(lang, t.appLoginTitle, "") +
    `<body>
<main class="app-login">
<h1>${h(t.appLoginTitle)}</h1>
<p>${subtitle}</p>
<div class="app-login-methods">
<p>${link(`/auth/nycu/start${q}`, t.appLoginNycu)}</p>
<p>${link(`/auth/github/login${q}`, t.appLoginGithub)}</p>
<p>${link(`/auth/google/login${q}`, t.appLoginGoogle)}</p>
</div>
<p class="muted">${h(t.appLoginNote)}</p>
</main>
</body></html>`
  );
}
