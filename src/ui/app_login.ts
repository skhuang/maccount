import type { Lang } from "../i18n";
import { T } from "../i18n";
import { langToggle } from "../i18n";
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
// the page's "card" (surface background, border, radius, shadow, font), and
// full-width `.button` links match the look of the site's other CTAs (e.g.
// the "admin_link" button on dashboardPage). No inline body style, so UI_CSS
// fully governs font/width/padding — this page should look identical to the
// rest of the site, not a narrower one-off.
export function appLoginChooserPage(lang: Lang, appId: string): string {
  const t = T[lang];
  const subtitle = t.appLoginSubtitle.replace("{app}", h(appId));
  const q = `?lang=${lang}`;
  const link = (href: string, label: string) =>
    `<p><a class="button" href="${href}" style="width:100%">${h(label)}</a></p>`;
  return (
    documentStart(lang, t.appLoginTitle, UI_CSS) +
    `<body>
<h1>${h(t.appLoginTitle)}</h1>
<p>${subtitle}</p>
${link(`/auth/nycu/start${q}`, t.appLoginNycu)}
${link(`/auth/github/login${q}`, t.appLoginGithub)}
${link(`/auth/google/login${q}`, t.appLoginGoogle)}
<p class="muted text-small">${h(t.appLoginNote)}</p>
</body></html>`
  );
}

// General account chooser shown after logout. NYCU keeps prompt=login so the
// university IdP asks for credentials again instead of silently reusing the
// account that just signed out of maccount.
export function accountLoginChooserPage(lang: Lang): string {
  const t = T[lang];
  const q = `lang=${lang}`;
  const link = (href: string, label: string, primary = false) =>
    `<p><a class="button${primary ? " button--primary" : ""}" href="${h(href)}" style="width:100%">${h(label)}</a></p>`;
  return (
    documentStart(lang, t.appLoginTitle, UI_CSS) +
    `<body>
<header class="topbar"><div>${langToggle("/login", lang)}</div></header>
<h1>${h(t.appLoginTitle)}</h1>
<p>${h(t.accountLoginSubtitle)}</p>
${link(`/auth/nycu/start?prompt=login&${q}`, t.appLoginNycu, true)}
${link(`/auth/github/login?${q}`, t.appLoginGithub)}
${link(`/auth/google/login?${q}`, t.appLoginGoogle)}
<p class="muted text-small">${h(t.appLoginNote)}</p>
</body></html>`
  );
}
