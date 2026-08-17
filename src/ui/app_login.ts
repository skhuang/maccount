import type { Lang } from "../i18n";
import { T } from "../i18n";
import { documentStart } from "./layout";
import { h } from "./components";
import { UI_CSS } from "../html";

// Login-method chooser shown to not-logged-in users hitting the relying-app
// SSO entry point (/auth/app/start). Each link is a same-origin login route
// (NYCU / GitHub / Google); the pre-login session cookie stashed by
// startApp (carrying app_return) rides along with the browser regardless of
// which method the user picks, so every callback still returns to the app.
//
// Markup mirrors the site's other simple pages (e.g. privacyPage,
// coursePrejoinPage in ../html.ts): the shared UI_CSS styles <body> itself as
// the page's "card" (surface background, border, radius, shadow), and
// full-width `.button` links match the look of the site's other CTAs (e.g.
// the "admin_link" button on dashboardPage).
export function appLoginChooserPage(lang: Lang, appId: string): string {
  const t = T[lang];
  const subtitle = t.appLoginSubtitle.replace("{app}", h(appId));
  const q = `?lang=${lang}`;
  const link = (href: string, label: string) =>
    `<p><a class="button" href="${href}" style="width:100%">${h(label)}</a></p>`;
  return (
    documentStart(lang, t.appLoginTitle, UI_CSS) +
    `<body style="font-family:system-ui;max-width:420px;margin:2rem auto;padding:0 1rem;line-height:1.6">
<h1>${h(t.appLoginTitle)}</h1>
<p>${subtitle}</p>
${link(`/auth/nycu/start${q}`, t.appLoginNycu)}
${link(`/auth/github/login${q}`, t.appLoginGithub)}
${link(`/auth/google/login${q}`, t.appLoginGoogle)}
<p class="muted text-small">${h(t.appLoginNote)}</p>
</body></html>`
  );
}
