import path from "node:path";
import { expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:8419";

// The plan's literal wording (docs/refactor-plan.md §4 W3-E2E row): "boot tracelabel
// --dir <tmp> --no-browser --port 8399, drive create → import → rubric → label."
// Unlike smoke.spec.ts (which reaches the label view through the CLI launcher's
// one-shot fast path), this spec drives every step through the real browser UI
// against a real spawned backend and no mocks: ProjectList's "New project" dialog ->
// ImportWizard -> ProjectHome's "New task" -> the New Task wizard (name -> sources ->
// level -> rubric) -> LabelView.
test("browser flow: create project, import a source, create a task, edit its rubric, and label", async ({
  page,
}) => {
  const projectName = `Browser Flow ${Date.now()}`;

  // ── ProjectList: create a project ──
  await page.goto(`${BASE_URL}/`);
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
  await page.getByLabel("Name").fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();

  // Lands on ProjectHome once the project exists.
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  // The Header breadcrumb (only reachable from the label view) shows the URL slug,
  // not this display name, so capture it here for that assertion later.
  const projectSlug = page.url().split("/p/")[1].split("/")[0];

  // ── ProjectHome: go to the import wizard ──
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(page).toHaveURL(/\/import$/);

  // ── ImportWizard: preview and import fixtures/traces.jsonl by server-local path ──
  const fixturePath = path.resolve(__dirname, "fixtures/traces.jsonl");
  await page.getByRole("radio", { name: "Server-local path" }).click();
  await page.getByPlaceholder("/path/to/traces.jsonl").fill(fixturePath);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Detected: ctf · 3 traces")).toBeVisible();

  // Server-local path mode never sets a display name on its own (that's DropZone's
  // job, for content mode) — its placeholder is the "pasted import" fallback used
  // when this field is left blank (see ImportWizard's handleImport), so fill it in.
  await page.getByPlaceholder("pasted import").fill("traces.jsonl");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Import complete\./)).toBeVisible();
  await page.getByRole("link", { name: "Back to project" }).click();

  // ── ProjectHome: the imported source is listed; "New task" now opens the New Task
  // wizard's own route instead of a modal. ──
  await expect(page.getByText("traces.jsonl")).toBeVisible();
  await page.getByRole("button", { name: "New task" }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);

  // ── New Task wizard, step 1: name. Task names must match NAME_PATTERN (lowercase
  // letters, digits, underscores — no hyphens). ──
  const taskName = "browser_flow_task";
  await page.getByPlaceholder("escalation_risk").fill(taskName);
  await page.getByRole("button", { name: "Next" }).click();

  // ── Step 2: sources — leave the default (all sources selected) and move on. ──
  await expect(page.getByText(/traces\.jsonl · 3 traces/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // ── Step 3: level — a radio card, not a <select>. The label view's totals below
  // are counted in traces (one target per trace), so pick "Trace level" explicitly
  // (it's also the wizard's default). ──
  await page.getByRole("radio", { name: /Trace level/ }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // ── Step 4: rubric — starts pre-populated with Pass/fail + reasoning, fully
  // editable inline with a live, interactive preview alongside it. Edit the
  // reasoning field's label to prove the inline editor (not just a preset picker)
  // is live, then move on to the review step. ──
  await expect(page.locator('input[value="verdict"]')).toBeVisible();
  const reasoningLabel = page.locator('input[value="Reasoning"]');
  await reasoningLabel.fill("Why?");
  await expect(page.getByText("Why?")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // ── Step 5: review — summary of the whole task, then create. ──
  await expect(page.getByText(taskName)).toBeVisible();
  await page.getByRole("button", { name: "Create task" }).click();

  // ── Back on ProjectHome: click the task card body (not just the name) into the
  // label view — the task card is a whole-card click target. ──
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  await page.getByRole("link", { name: taskName }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${taskName}/label$`));

  // ── LabelView: the session for the task we just created is loaded, and a real
  // commit persists through the same public API smoke.spec.ts checks. The
  // breadcrumb (tracelabel / {project}) is the only way out of this view. ──
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  await expect(page.getByText("0/3", { exact: true })).toBeVisible();

  // Pick the "pass" verdict (digit 1 acts on the primary select field), then "r"
  // focuses the reasoning textarea; Ctrl+Enter commits (a bare Enter there is a
  // newline, not a commit).
  await page.keyboard.press("1");
  await page.keyboard.press("r");
  await page.keyboard.type("looks fine");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("1/3", { exact: true })).toBeVisible();

  // The breadcrumb returns to the project screen.
  await page.getByRole("link", { name: projectSlug }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectSlug}$`));
});
