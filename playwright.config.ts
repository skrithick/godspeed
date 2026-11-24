import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3147", ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: {
    command: "npm run start -- --port 3147",
    url: "http://127.0.0.1:3147",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
