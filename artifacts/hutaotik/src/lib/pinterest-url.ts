const PINTEREST_HOSTS = new Set(["pinterest.com", "pin.it", "pinimg.com"]);

export function extractFirstHttpUrl(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  return (match?.[0] ?? trimmed).replace(/[),.;!?]+$/, "");
}

export function isPinterestUrl(input: string): boolean {
  try {
    const url = new URL(extractFirstHttpUrl(input));
    const hostname = url.hostname.toLowerCase();
    const isPinterestLocale = /(^|\.)pinterest\.[a-z]{2,}(?:\.[a-z]{2,3})?$/i.test(hostname);
    const isPinterestMedia = hostname === "pinimg.com" || hostname.endsWith(".pinimg.com");
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (isPinterestLocale ||
        isPinterestMedia ||
        [...PINTEREST_HOSTS].some((host) => hostname === host || hostname.endsWith(`.${host}`)))
    );
  } catch {
    return false;
  }
}
