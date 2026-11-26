import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { build } from "vite";

const apiUrl = process.env.VITE_API_URL?.trim();
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

process.env.PORT ??= "22394";
process.env.BASE_PATH = "./";
process.env.NODE_ENV = "production";
process.env.VITE_APP_MODE = "admin";
process.env.VITE_FIREBASE_PUSH_ENABLED = "false";
process.env.VITE_DEFAULT_RELEASE_VERSION_CODE = versionCode;
process.env.VITE_DEFAULT_RELEASE_VERSION_NAME = versionName;

await build({ configFile: "vite.config.ts" });

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
execSync(`${packageManager} exec cap sync android`, {
  stdio: "inherit",
  env: process.env,
});
