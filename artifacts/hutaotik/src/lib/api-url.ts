const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const ADMIN_API_BASE_KEY = "hutaotik_admin_api_url";

export function apiUrl(path: string): string {
  const runtimeAdminUrl =
    import.meta.env.VITE_APP_MODE === "admin" && typeof window !== "undefined"
      ? localStorage.getItem(ADMIN_API_BASE_KEY)
      : null;
  return `${(runtimeAdminUrl || apiBaseUrl).replace(/\/+$/, "")}${path}`;
}

export function saveAdminApiUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Enter the HTTPS base URL for the Hutaotik API server.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/api(?:\/.*)?$/i, "");
  const normalized = parsed.toString().replace(/\/+$/, "");
  localStorage.setItem(ADMIN_API_BASE_KEY, normalized);
  return normalized;
}