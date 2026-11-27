import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { build } from "vite";

const apiUrl = process.env.VITE_API_URL?.trim() || "https://hutaotiktok-mja6.onrender.com";
const gradleFile = new URL("./android/app/build.gradle", import.meta.url);
const gradleConfig = readFileSync(gradleFile, "utf8");
const versionCode = gradleConfig.match(
  /configuredVersionCode\s*=\s*\(project\.findProperty\('appVersionCode'\)\s*\?:\s*"(\d+)"\)/,
)?.[1];
const versionName = gradleConfig.match(
  /configuredVersionName\s*=\s*project\.findProperty\('appVersionName'\)\s*\?:\s*"([^"]+)"/,
)?.[1];

if (!versionCode || !versionName) {
  throw new Error("Could not read the Hutaotik app version from android/app/build.gradle.");
}

if (apiUrl && new URL(apiUrl).protocol !== "https:") {
  throw new Error("VITE_API_URL must use HTTPS for Android builds.");
}

function resolveAdminAppKey() {
  const fromEnv = (process.env.VITE_ADMIN_APP_KEY || process.env.ADMIN_APP_KEY || "").trim();
  if (fromEnv) return fromEnv;

  const keyFileUrl = new URL("./.admin-app-key.local", import.meta.url);
  if (existsSync(keyFileUrl)) {
    const raw = readFileSync(keyFileUrl, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^(?:VITE_)?ADMIN_APP_KEY\s*=\s*(.+)$/);
      const value = (match ? match[1] : trimmed).trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }

  const generated = randomBytes(32).toString("hex");
  writeFileSync(
    keyFileUrl,
    [
      "# Local private key embedded ONLY into Hutaotik-Admin.apk (gitignored — never commit).",
      "# Add this exact value to your Render API Environment Variables as ADMIN_APP_KEY,",
      "# OR replace it with your existing Render ADMIN_PASSWORD and rebuild Hutaotik-Admin.apk.",
      `ADMIN_APP_KEY=${generated}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  console.log("Generated new local admin app key at artifacts/hutaotik/.admin-app-key.local");
  return generated;
}

const adminAppKey = resolveAdminAppKey();

process.env.PORT ??= "22394";
process.env.BASE_PATH = "./";
process.env.NODE_ENV = "production";
process.env.VITE_API_URL = apiUrl;
process.env.VITE_APP_MODE = "admin";
process.env.VITE_ADMIN_APP_KEY = adminAppKey;
process.env.VITE_FIREBASE_PUSH_ENABLED = "false";
process.env.VITE_DEFAULT_RELEASE_VERSION_CODE = versionCode;
process.env.VITE_DEFAULT_RELEASE_VERSION_NAME = versionName;

await build({ configFile: "vite.config.ts" });

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
execSync(`${packageManager} exec cap sync android`, {
  stdio: "inherit",
  env: process.env,
});
