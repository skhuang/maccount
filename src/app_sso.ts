import type { Env } from "./env";

const TOKEN_TTL_MS = 5 * 60 * 1000;

export interface AppClaims {
  sub: string;
  providers: { github: boolean; google: boolean };
  aud: string;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function appAllowlist(env: Env): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (env.APP_ALLOWLIST || "").split(";")) {
    const t = pair.trim(); if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) m.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return m;
}

export function allowedReturn(env: Env, app: string, ret: string): boolean {
  const prefix = appAllowlist(env).get(app);
  if (!prefix || typeof ret !== "string") return false;
  return ret === prefix || ret.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
}

export function allowedOrigin(env: Env, origin: string): boolean {
  if (!origin) return false;
  for (const prefix of appAllowlist(env).values()) {
    try { if (new URL(prefix).origin === origin) return true; } catch { /* skip */ }
  }
  return false;
}

export async function mintAppToken(env: Env, claims: AppClaims & { _iat?: number }): Promise<string> {
  const iat = claims._iat ?? Date.now();
  const body = { sub: claims.sub, providers: claims.providers, aud: claims.aud, iat, exp: iat + TOKEN_TTL_MS };
  const enc = new TextEncoder();
  const payload = b64urlEncode(enc.encode(JSON.stringify(body)));
  const key = await hmacKey(env.APP_TOKEN_SECRET);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${payload}.${b64urlEncode(sig)}`;
}

export async function verifyAppToken(env: Env, token: string): Promise<{ sub: string; providers: { github: boolean; google: boolean }; aud: string } | null> {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sigPart] = token.split(".");
  const enc = new TextEncoder();
  const key = await hmacKey(env.APP_TOKEN_SECRET);
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(sigPart), enc.encode(payload)); } catch { return null; }
  if (!ok) return null;
  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))); } catch { return null; }
  if (!body || typeof body.exp !== "number" || Date.now() > body.exp) return null;
  if (!appAllowlist(env).has(body.aud)) return null;
  return { sub: String(body.sub), providers: { github: !!body.providers?.github, google: !!body.providers?.google }, aud: String(body.aud) };
}
