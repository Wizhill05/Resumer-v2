export function safeReturnTo(value: string | null | undefined, requestUrl: string): string {
  if (!value) return "/account";
  if (!value.startsWith("/")) return "/account";
  if (value.includes("\\")) return "/account";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return "/account";
  }
  try {
    const parsed = new URL(value, requestUrl);
    const base = new URL(requestUrl);
    if (parsed.origin !== base.origin) return "/account";
    return parsed.pathname + parsed.search;
  } catch {
    return "/account";
  }
}
