import type { Lang } from "../i18n";

export function htmlLang(lang: Lang): string {
  return lang === "en" ? "en" : "zh-Hant";
}

export function documentStart(lang: Lang, title: string, css: string): string {
  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
<title>${title}</title>`;
}
