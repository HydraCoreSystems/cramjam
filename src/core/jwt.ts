const TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64urlToString(input: string): string | null {
  const s = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  let bits = 0;
  let acc = 0;
  const bytes: number[] = [];
  for (const ch of s) {
    const v = TABLE.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  try {
    let out = "";
    for (const b of bytes) out += String.fromCharCode(b);
    return decodeURIComponent(escape(out));
  } catch {
    return null;
  }
}

/** Expiry of a JWT in milliseconds, or null when it cannot be read. The token is never verified here. */
export function jwtExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  const json = b64urlToString(part);
  if (!json) return null;
  try {
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the token is missing an expiry, expired, or expires within the margin. */
export const tokenStale = (token: string, now: number, marginMs = 60_000): boolean => {
  const exp = jwtExpiry(token);
  return exp == null || exp - now < marginMs;
};
