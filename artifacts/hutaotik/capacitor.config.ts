import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: process.env.VITE_APP_MODE === "admin" ? "com.hutaotik.admin" : "com.hutaotik.app",
  appName: process.env.VITE_APP_MODE === "admin" ? "Hutaotik Admin" : "Hutao Tik",
  webDir: "dist/public",
};

export default config;