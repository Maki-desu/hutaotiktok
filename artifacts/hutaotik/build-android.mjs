import { existsSync, readFileSync } from "node:fs";
import { build } from "vite";

const apiUrl = process.env.VITE_API_URL?.trim();

if (!apiUrl) {
  throw new Error(
    "Set VITE_API_URL to the deployed API base URL before building the Android app.",
  );
}

const parsedApiUrl = new URL(apiUrl);
if (parsedApiUrl.protocol !== "https:") {
  throw new Error("VITE_API_URL must use HTTPS for Android builds.");
}

const gradleFile = new URL("./android/app/build.gradle", import.meta.url);
const gradleConfig = readFileSync(gradleFile, "utf8");
const versionCode = gradleConfig.match(
  /configuredVersionCode\s*=\s*\(project\.findProperty\('appVersionCode'\)\s*\?:\s*"(\d+)"\)/,
)?.[1];
const versionName = gradleConfig.match(
  /configuredVersionName\s*=\s*project\.findProperty\('appVersionName'\)\s*\?:\s*"([^"]+)"/,
)?.[1];
if (!versionCode) {
  throw new Error("Could not read versionCode from android/app/build.gradle.");
}
if (!versionName) {
  throw new Error("Could not read versionName from android/app/build.gradle.");
}

const pushEnabled = process.env.VITE_FIREBASE_PUSH_ENABLED === "true";
const googleServicesFile = new URL("./android/app/google-services.json", import.meta.url);
if (pushEnabled && !existsSync(googleServicesFile)) {
  throw new Error(
    "VITE_FIREBASE_PUSH_ENABLED=true requires android/app/google-services.json from your Firebase project.",
  );
}

process.env.PORT ??= "22394";
process.env.BASE_PATH = "./";
process.env.NODE_ENV = "production";
process.env.VITE_APP_MODE = "user";
process.env.VITE_APP_VERSION_CODE = versionCode;
process.env.VITE_APP_VERSION_NAME = versionName;
process.env.VITE_FIREBASE_PUSH_ENABLED = pushEnabled ? "true" : "false";

await build({ configFile: "vite.config.ts" });