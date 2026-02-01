export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  path?: string;
  maxAgeSeconds?: number;
};

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName) continue;
    const rawValue = rest.join("=");
    if (!rawValue) continue;
    out[rawName] = decodeURIComponent(rawValue);
  }
  return out;
}

export function makeSetCookie(name: string, value: string, opts: CookieOptions = {}) {
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.maxAgeSeconds != null) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
}
