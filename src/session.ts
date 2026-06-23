export interface SessionData {
  exp: number;
  nstate?: string; // CSRF state for the NYCU leg (pre-login)
  gstate?: string; // CSRF state for the GitHub leg (while binding)
  gostate?: string; // CSRF state for the Google leg (while binding)
  next?: string; // post-login redirect target (validated relative path, e.g. /me/<course>)
  nycu?: { id: string; name: string }; // present once logged in; admin is derived via isAdmin()
}

export const SESSION_COOKIE = "maccount_session";
const TTL_SECONDS = 900;
const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
