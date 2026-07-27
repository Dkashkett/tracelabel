import path from "node:path";
import { expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:8419";

// The plan's literal wording (docs/refactor-plan.md §4 W3-E2E row): "boot tracelabel
// --dir <tmp> --no-browser --port 8399, drive create → import → rubric → label."
// Unlike smoke.spec.ts (which reaches the label view through the CLI launcher's
// one-shot fast path), this spec drives every step through the real browser UI
// against a real spawned backend and no mocks: ProjectList's "New project" dialog ->
// ImportWizard -> ProjectHome's "New task" dialog -> RubricEditor -> LabelView.
test("browser flow: create project, import a source, create a task, save its rubric, and label", async ({
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

  // ── ProjectHome: the imported source is listed; create a task ──
  await expect(page.getByText("traces.jsonl")).toBeVisible();
  await page.getByRole("button", { name: "New task" }).click();
  // Task names must match NewTaskDialog's NAME_PATTERN (lowercase letters, digits,
  // underscores — no hyphens).
  const taskName = "browser_flow_task";
  await page.getByPlaceholder("escalation-risk").fill(taskName);
  // NewTaskDialog defaults to level="turn"; the label view's totals below are
  // counted in traces (one target per trace), so select "Trace" explicitly.
  await page.getByLabel("Level").selectOption("trace");
  // Leave the "Pass / fail" preset (the dialog's default choice) selected — its single
  // required `verdict` field is exactly what the label-view steps below need.
  await page.getByRole("button", { name: "Create task" }).click();

  // ── RubricEditor: the preset's field is there; save it unchanged ──
  await expect(page).toHaveURL(new RegExp(`/t/${taskName}/schema$`));
  await expect(page.locator('input[value="verdict"]')).toBeVisible();
  await page.getByText("Save", { exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // ── Back to ProjectHome, then into the label view via the real task link ──
  await page.goto(`${BASE_URL}/p/${page.url().split("/p/")[1].split("/")[0]}`);
  await page.getByRole("link", { name: taskName }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${taskName}/label$`));

  // ── LabelView: the session for the task we just created is loaded, and a real
  // commit persists through the same public API smoke.spec.ts checks. ──
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  await expect(page.getByText("0/3", { exact: true })).toBeVisible();

  await page.keyboard.press("1"); // verdict = pass, the only required field
  // Ctrl+Enter is only needed to commit *from inside a textarea* (a bare Enter there
  // is a newline, not a commit — see smoke.spec.ts); this task has no text field, so
  // focus never leaves the radiogroup and a bare Enter commits, matching the on-screen
  // "Enter · commit" hint.
  await page.keyboard.press("Enter");
  await expect(page.getByText("1/3", { exact: true })).toBeVisible();
});
