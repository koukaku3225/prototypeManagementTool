/** Only use for redirect URLs returned by the authenticated OAuth SDK. */
export function safeOAuthRedirect(value: string): string | null {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (url.protocol === "https:" || localHttp) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
