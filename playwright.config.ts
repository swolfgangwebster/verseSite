import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://localhost:3100",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100",
    url: "http://localhost:3100/api/bootstrap",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      APP_ENV: "development",
      DEV_AUTH: "true",
      APP_ORIGIN: "http://localhost:3100",
      DB_PATH: `.data/e2e-${Date.now()}.sqlite`,
    },
  },
});
