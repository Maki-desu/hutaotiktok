import { extractFirstHttpUrl } from "./pinterest-url";

const INSTAGRAM_HOSTS = new Set(["instagram.com", "instagr.am"]);

export function isInstagramUrl(input: string): boolean {
  try {
    const url = new URL(extractFirstHttpUrl(input));
    const hostname = url.hostname.toLowerCase();
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      [...INSTAGRAM_HOSTS].some((host) => hostname === host || hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}
