import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4179",
    browserName: "chromium",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: process.cwd(),
    command:
      "node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts",
    url: "http://127.0.0.1:4179/tests/browser/harness.html",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
