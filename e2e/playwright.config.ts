import { defineConfig, devices } from "@playwright/test";

const PORT = 8399;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TURN_PORT = 8409;
const TURN_BASE_URL = `http://127.0.0.1:${TURN_PORT}`;
const DB_PATH = `/tmp/tracelabel-e2e-${process.pid}-${Date.now()}.db`;
const TURN_DB_PATH = `/tmp/tracelabel-e2e-turn-${process.pid}-${Date.now()}.db`;

// Spawn the *installed* tracelabel server with an isolated database and wait until it is
// browser-ready. The 3 s cold-start NFR (09 §3) times five gives CI slack; Playwright polls the
// URL until it answers.
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
  webServer: [
    {
      command:
        `tracelabel serve fixtures/traces.jsonl --db ${DB_PATH} ` +
        `--port ${PORT} --no-browser --yes`,
      url: `${BASE_URL}/api/session`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command:
        `tracelabel serve fixtures/turn/config.yaml --db ${TURN_DB_PATH} ` +
        `--port ${TURN_PORT} --no-browser --yes`,
      url: `${TURN_BASE_URL}/api/session`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
