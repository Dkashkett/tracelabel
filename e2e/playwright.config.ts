import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8399;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TURN_PORT = 8409;
const TURN_BASE_URL = `http://127.0.0.1:${TURN_PORT}`;
const BROWSER_PORT = 8419;
const BROWSER_BASE_URL = `http://127.0.0.1:${BROWSER_PORT}`;

// Each server gets its own throwaway `~/.tracelabel`-style workspace directory (the
// post-refactor CLI has no more `--db`/single-database flag — see cli/app.py) so the
// three suites below never collide with each other or with a developer's real
// workspace.
const WORKSPACE_DIR = path.join(process.env.TMPDIR ?? "/tmp", `tracelabel-e2e-${process.pid}-${Date.now()}`);
const TURN_WORKSPACE_DIR = path.join(
  process.env.TMPDIR ?? "/tmp",
  `tracelabel-e2e-turn-${process.pid}-${Date.now()}`,
);
const BROWSER_WORKSPACE_DIR = path.join(
  process.env.TMPDIR ?? "/tmp",
  `tracelabel-e2e-browser-${process.pid}-${Date.now()}`,
);

// `uv run tracelabel`, not a bare `tracelabel` off PATH: this repo has no separate
// install step in CI/dev, and a bare `tracelabel` can silently resolve to a
// *different* checkout's installed console-script (see CLAUDE.md's install row —
// `uv sync` is per-project). `env -u VIRTUAL_ENV` guards against a stray VIRTUAL_ENV
// left over from another shell/venv pointing `uv run` at the wrong environment
// entirely, which reads as "stale code" and is easy to misdiagnose.
//
// The release workflow is the one deliberate exception: it needs to exercise the
// *installed wheel* in a throwaway venv, not the source checkout, so it points PATH
// at that venv and sets PLAYWRIGHT_TRACELABEL_CMD=tracelabel to bypass `uv run`
// entirely (see release.yml's "Playwright smoke on the wheel" step).
const TRACELABEL = process.env.PLAYWRIGHT_TRACELABEL_CMD ?? "env -u VIRTUAL_ENV uv run tracelabel";

// Spawn real `tracelabel` server processes and wait until each is browser-ready.
// `/api/settings` is the health check (it always answers once the process is up, no
// project/task required — the old `/api/session` needed one to already exist and no
// longer exists at all as a bare path under the new project/task-scoped API). Note
// that "the server answers" is *not* the same as "the project/task this spec needs
// exists" for the two servers below that boot with no TARGET; those specs establish
// their own project/task over HTTP before navigating anywhere.
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // smoke.spec.ts: the one-shot launcher idempotently creates a project + a
      // zero-config trace-level pass/fail task for this fixture and opens straight
      // into the labeling view — the fast path for exercising keyboard-driven
      // labeling without touching the browser UI flow at all.
      command: `${TRACELABEL} fixtures/traces.jsonl --dir ${WORKSPACE_DIR} --port ${PORT} --no-browser`,
      url: `${BASE_URL}/api/settings`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // turn-tools.spec.ts: no TARGET, since the launcher can always create only a
      // level="trace"/label_roles=["assistant"] task and this fixture needs
      // level="turn"/label_roles=["assistant","tool"]. The spec drives project/task
      // creation and the import itself over the HTTP API before navigating.
      command: `${TRACELABEL} --dir ${TURN_WORKSPACE_DIR} --port ${TURN_PORT} --no-browser`,
      url: `${TURN_BASE_URL}/api/settings`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // browser-flow.spec.ts: no TARGET — this spec drives the whole SPA by hand
      // (create project -> import wizard -> rubric editor -> label view), so it
      // needs an empty workspace to create its own project into, not one the
      // launcher has already pre-populated.
      command: `${TRACELABEL} --dir ${BROWSER_WORKSPACE_DIR} --port ${BROWSER_PORT} --no-browser`,
      url: `${BROWSER_BASE_URL}/api/settings`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
