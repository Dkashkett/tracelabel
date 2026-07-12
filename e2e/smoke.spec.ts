import { expect, test } from "@playwright/test";

// E2E-01 — the pitch. `demo` → 1 → type reason → commit → the annotation exists and progress
// incremented. This single test protects the entire value proposition (09 §4). The bundled demo
// runs the zero-config default, which is a *trace*-level pass/fail task (design 03 §2), so the
// label target is the whole trace; `j`/turn navigation and the per-turn accent ring are
// turn-level affordances that don't apply here.
test("demo: keyboard-label the first trace and it persists", async ({ page, request }) => {
  const REASON = `e2e smoke ${Date.now()}`;

  await page.goto("/");

  // The annotation form rendering is the proof the app booted and the queue loaded.
  const reasoning = page.getByPlaceholder("Why is this a pass or fail?");
  await expect(reasoning).toBeVisible();

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
});
