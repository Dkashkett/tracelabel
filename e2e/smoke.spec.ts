import { expect, test } from "@playwright/test";

// E2E-01 — the pitch. Load traces → label → persist → finish → review. The focused fixture runs
// the zero-config default, which is a *trace*-level pass/fail task (design 03 §2), so the label
// target is the whole trace; `j`/turn navigation and per-turn accent rings do not apply here.
test("workflow: annotations persist, completion is derived, and traces remain reviewable", async ({
  page,
  request,
}) => {
  const REASON = `e2e smoke ${Date.now()}`;
  const FINAL_REASON = `e2e final ${Date.now()}`;

  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);

  // The annotation form rendering is the proof the app booted and the queue loaded.
  const reasoning = page.getByPlaceholder("Why is this a pass or fail?");
  await expect(reasoning).toBeVisible();
  const tracesToggle = page.getByRole("button", { name: /traces \(\d+\)/i });
  await expect(tracesToggle).toContainText("▸");

  // Matched tool output belongs to its assistant row and starts collapsed. Expanding exercises
  // the virtual-row remeasurement path before normal labeling continues.
  const toolInteraction = page.getByRole("button", { name: /lookup_order/ });
  await expect(toolInteraction).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(/status:/)).toBeHidden();
  await toolInteraction.click();
  await expect(page.getByText(/status:/)).toBeVisible();
  await toolInteraction.click();

  // 1: pick verdict "pass" on the primary select. r: focus the reasoning textarea; type a reason;
  // commit with Ctrl+Enter — a bare Enter inside a textarea is a newline, not a commit (06 §2).
  await page.keyboard.press("1");
  await page.keyboard.press("r");
  await expect(reasoning).toBeFocused(); // `r` focuses on the next animation frame
  await page.keyboard.type(REASON);
  await page.keyboard.press("Control+Enter");

  // The real proof is server-side, not DOM state: progress incremented…
  await expect
    .poll(async () => (await (await request.get("/api/progress")).json()).labeled)
    .toBe(1);

  // …and a fresh read of the trace returns the annotation with the reasoning we typed.
  const queue = await (await request.get("/api/queue")).json();
  const traceId = queue[0].trace_id;
  const detail = await (await request.get(`/api/traces/${traceId}`)).json();
  const annotations = Object.values(detail.annotations) as Array<{
    status: string;
    values: Record<string, unknown>;
  }>;
  const saved = annotations.find((a) => a.values.reasoning === REASON);
  expect(saved, "annotation with the typed reasoning must exist").toBeTruthy();
  expect(saved!.status).toBe("labeled");
  expect(saved!.values.verdict).toBe("pass");

  // Commit optimistically advances to the next trace, so the ●saved indicator lives on the target
  // we just left. Step back to it and confirm the UI reflects the persisted label (06 §2.3).
  await page.keyboard.press("p");
  await expect(page.getByText("saved")).toBeVisible();

  // Put every middle target into a persisted skipped state through the same public API, leaving
  // the physical final item for the browser flow. Reloading proves completion is based on server
  // progress rather than local mutation bookkeeping.
  expect(queue.length).toBeGreaterThan(2);
  for (const entry of queue.slice(1, -1)) {
    const response = await request.put("/api/annotations", {
      data: {
        target_type: "trace",
        target_id: entry.trace_id,
        status: "skipped",
        values: {},
        prefill_model: null,
      },
    });
    expect(response.ok()).toBeTruthy();
  }

  await page.reload();
  await expect(reasoning).toBeVisible();
  await expect(tracesToggle).toContainText("▸");

  // The queue starts at its first item even though only the last target is unfinished. Direct
  // drawer navigation remains available while the footer defaults to collapsed.
  await tracesToggle.click();
  const lastTraceId = queue[queue.length - 1].trace_id;
  const lastTraceButton = page.getByRole("button", { name: new RegExp(lastTraceId) });
  await lastTraceButton.click();
  await expect(reasoning).toBeVisible();
  await tracesToggle.click();
  await expect(lastTraceButton).toBeHidden();

  await page.keyboard.press("1");
  await page.keyboard.press("r");
  await expect(reasoning).toBeFocused();
  await page.keyboard.type(FINAL_REASON);
  await page.keyboard.press("Control+Enter");

  await expect(page.getByRole("heading", { name: "Dataset finished" })).toBeVisible();
  const completed = await (await request.get("/api/progress")).json();
  expect(completed.labeled + completed.skipped).toBe(completed.total);
  await expect(page.getByText(`${completed.total}/${completed.total}`, { exact: true })).toBeVisible();

  // The primary action opens the collapsed footer; choosing a trace leaves completion mode and
  // restores the persisted form in editable review mode.
  await page.getByRole("button", { name: "Review traces" }).click();
  const firstTraceButton = page.getByRole("button", { name: new RegExp(queue[0].trace_id) });
  await expect(firstTraceButton).toBeVisible();
  await firstTraceButton.click();
  await expect(reasoning).toBeVisible();
  await expect(reasoning).toHaveValue(REASON);
  await expect(page.getByText("saved")).toBeVisible();
});
