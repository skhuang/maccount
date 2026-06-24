import type { Strings } from "../i18n";

export function h(v: unknown): string {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function confirmAttrs(title: string, message: string, action: string, when = ""): string {
  return `data-confirm-title="${h(title)}" data-confirm-message="${h(message)}" data-confirm-action="${h(action)}"${
    when ? ` data-confirm-when="${h(when)}"` : ""
  }`;
}

export function accountStatusCard(
  t: Strings,
  label: string,
  value: string | null | undefined,
  href: string,
  action: string,
): string {
  return `<article class="status-card">
  <div class="status-card__head"><span class="status-card__title">${label}</span><span class="badge badge--${value ? "success" : "warning"}">${value ? t.bound : t.not_bound}</span></div>
  <p class="status-card__value">${value ? `<b>${h(value)}</b>` : t.not_bound}</p>
  <p class="status-card__action"><a class="${value ? "" : "button"}" href="${href}">${value ? t.rebind : action}</a></p>
</article>`;
}

export function repoHref(repo: string | null | undefined): string | null {
  if (!repo) return null;
  return /^https?:\/\//.test(repo) ? repo : `https://github.com/${repo}`;
}

export function verdictBadge(verdict: string | null | undefined): string {
  const value = (verdict ?? "-").trim() || "-";
  const normalized = value.toUpperCase();
  const tone = ["AC", "PASS", "PASSED", "OK"].includes(normalized)
    ? "success"
    : ["WA", "RE", "TLE", "MLE", "CE", "FAIL", "FAILED"].includes(normalized)
      ? "danger"
      : normalized === "-"
        ? "neutral"
        : "warning";
  return `<span class="badge badge--${tone}">${h(value)}</span>`;
}

export function fmtTime(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "-";
  const s = String(raw).trim();
  const num = Number(s);
  let d: Date;
  if (Number.isFinite(num) && num > 0) {
    d = new Date(num * (num < 1e12 ? 1000 : 1));
  } else {
    d = new Date(s);
  }
  if (isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}
