export function safeReturnTo(value: string | null | undefined, requestUrl: string, fallback = "/account"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.includes("\\")) return fallback;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  try {
    const parsed = new URL(value, requestUrl);
    const base = new URL(requestUrl);
    if (parsed.origin !== base.origin) return fallback;
    return parsed.pathname + parsed.search;
  } catch {
    return fallback;
  }
}
