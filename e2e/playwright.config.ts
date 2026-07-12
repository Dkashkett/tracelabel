import { defineConfig, devices } from "@playwright/test";

const PORT = 8399;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Spawn the *installed* tracelabel server and wait until it is browser-ready. The 3 s cold-start
// NFR (09 §3) times five gives CI slack; Playwright polls the URL until it answers.
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `tracelabel demo --port ${PORT} --no-browser`,
    url: `${BASE_URL}/api/session`,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
