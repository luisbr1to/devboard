import { defineConfig } from "@playwright/test";
import { e2eDatabaseUrl } from "./database";

const port = 4180;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "local.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: process.cwd(),
    command: "node dist/index.js",
    env: {
      AUTH_MODE: "local",
      TESTHUB_SETUP_CODE: "e2e-setup-code",
      DATABASE_URL: e2eDatabaseUrl(),
      PORT: String(port),
      SSL_CRT_FILE: "",
      SSL_KEY_FILE: "",
    },
    url: `${baseURL}/api/v1/config`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
