import { expect, test } from "@playwright/test";

const TURN_BASE_URL = "http://127.0.0.1:8409";

test("turn mode nests a tool result in its call's activity cascade, but keeps it independently navigable and labelable", async ({
  page,
  request,
}) => {
  await page.goto(TURN_BASE_URL);

  const session = await (await request.get(`${TURN_BASE_URL}/api/session`)).json();
  expect(session.level).toBe("turn");
  expect(session.label_roles).toContain("tool");

  const queue = await (await request.get(`${TURN_BASE_URL}/api/queue`)).json();
  const traceId = queue[0].trace_id;
  const detail = await (await request.get(`${TURN_BASE_URL}/api/traces/${traceId}`)).json();
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
  await expect(page.getByText(`turn #${resultTurn.idx}`, { exact: true })).toBeVisible();
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
      const refreshed = await (
        await request.get(`${TURN_BASE_URL}/api/traces/${traceId}`)
      ).json();
      return refreshed.annotations[resultTurn.id]?.values?.verdict;
    })
    .toBe("pass");
});
