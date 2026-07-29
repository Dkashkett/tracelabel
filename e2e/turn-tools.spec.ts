import path from "node:path";
import { expect, test } from "@playwright/test";

const TURN_BASE_URL = "http://127.0.0.1:8409";

// The old `fixtures/turn/config.yaml` set `level: turn` / `label_roles: [assistant,
// tool]` for this fixture's task via the pre-refactor YAML-config CLI. The new
// launcher (`tracelabel TARGET --dir ... `) has no flag for that — it always creates
// a level="trace"/label_roles=["assistant"] task (see AppCommand._import_and_open_task
// in cli/commands.py). So this spec drives project + task creation and the import
// itself directly over the real, tested Wave-2 HTTP routes (POST /api/projects,
// POST .../tasks, POST .../imports) against a server booted with no TARGET
// (`tracelabel --dir ... --no-browser`, see playwright.config.ts), then navigates
// straight to the resulting label-view URL. This is simpler than teaching the CLI a
// new flag for a single e2e fixture, and it exercises the same real routes the
// browser's ImportWizard/RubricEditor screens call.
const DEFAULT_TASK_FIELDS = [
  { name: "verdict", label: "Verdict", type: "single_select", options: ["pass", "fail"], required: true },
  { name: "reasoning", label: "Reasoning", type: "text", placeholder: "Why is this a pass or fail?", required: true },
];

async function setUpTurnTask(request: import("@playwright/test").APIRequestContext) {
  const project = await (
    await request.post(`${TURN_BASE_URL}/api/projects`, { data: { name: "turn-tools" } })
  ).json();

  const task = await (
    await request.post(`${TURN_BASE_URL}/api/projects/${project.slug}/tasks`, {
      data: {
        name: "e2e-turn-tools",
        level: "turn",
        label_roles: ["assistant", "tool"],
        fields: DEFAULT_TASK_FIELDS,
      },
    })
  ).json();

  const fixturePath = path.resolve(__dirname, "fixtures/turn/traces.jsonl");
  const importRef = await (
    await request.post(`${TURN_BASE_URL}/api/projects/${project.slug}/imports`, {
      data: { path: fixturePath, name: "traces.jsonl" },
    })
  ).json();

  await expect
    .poll(async () => (await (await request.get(`${TURN_BASE_URL}/api/jobs/${importRef.job_id}`)).json()).state)
    .toBe("done");

  return { projectSlug: project.slug, taskName: task.name };
}

test("turn mode nests a tool result in its call's activity cascade, but keeps it independently navigable and labelable", async ({
  page,
  request,
}) => {
  const { projectSlug, taskName } = await setUpTurnTask(request);
  const taskApi = (suffix: string) =>
    `${TURN_BASE_URL}/api/projects/${projectSlug}/tasks/${taskName}${suffix}`;

  await page.goto(`${TURN_BASE_URL}/p/${projectSlug}/t/${taskName}/label`);

  const session = await (await request.get(taskApi("/session"))).json();
  expect(session.level).toBe("turn");
  expect(session.label_roles).toContain("tool");

  const queue = await (await request.get(taskApi("/queue"))).json();
  const traceId = queue[0].trace_id;
  const detail = await (await request.get(taskApi(`/traces/${traceId}`))).json();
  const callTurn = detail.turns.find(
    (turn: { role: string; tool_calls?: unknown[] }) =>
      turn.role === "assistant" && (turn.tool_calls?.length ?? 0) > 0,
  );
  const resultTurn = detail.turns.find((turn: { role: string }) => turn.role === "tool");
  expect(callTurn).toBeTruthy();
  expect(resultTurn).toBeTruthy();

  const callId = callTurn.tool_calls[0].id;
  // The tool result nests inside the call's activity cascade, so it shares one DOM node
  // (the ToolStep section) that carries both `data-tool-call` and its own `data-turn-id`.
  const card = page.locator(`[data-turn-id="${callTurn.id}"] [data-tool-call="${callId}"]`);
  const cardToggle = card.getByRole("button").first();
  const resultRow = page.locator(`[data-turn-id="${resultTurn.id}"]`);
  await expect(resultRow).toHaveCount(1);

  // The first labelable target is the assistant call. Its cascade auto-expands (the owning
  // turn is active), showing the call's arguments and the paired result together.
  await expect(cardToggle).toHaveAttribute("aria-expanded", "true");
  await expect(card).toContainText('"order_id":"42"');
  await expect(resultRow).toHaveAttribute("data-labelable", "true");

  // j follows labelable source turns, so the independently labelable tool result becomes active
  // — the same nested row, now highlighted and still expanded (the specific active step).
  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: `Turn #${resultTurn.idx}` })).toBeVisible();
  await expect(resultRow).toHaveAttribute("data-active", "true");
  await expect(cardToggle).toHaveAttribute("aria-expanded", "true");

  // Clicking and annotating the tool row writes an annotation for the tool turn's own target id.
  // Reasoning is required by the default preset, so provide it before committing (r focuses the
  // textarea; Ctrl+Enter commits since a bare Enter in a textarea is a newline).
  await resultRow.click();
  await page.keyboard.press("1");
  await page.keyboard.press("r");
  // Wait for the animation-frame focus before typing — otherwise digits in the reason would be
  // read as verdict hotkeys by the primary select rather than textarea input.
  const reasoning = page.getByPlaceholder("Why is this a pass or fail?");
  await expect(reasoning).toBeFocused();
  await page.keyboard.type("tool result looks correct");
  await page.keyboard.press("Control+Enter");
  await expect
    .poll(async () => {
      const refreshed = await (await request.get(taskApi(`/traces/${traceId}`))).json();
      return refreshed.annotations[resultTurn.id]?.values?.verdict;
    })
    .toBe("pass");
});
