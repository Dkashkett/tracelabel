import { expect, test } from "@playwright/test";

const TURN_BASE_URL = "http://127.0.0.1:8409";

test("turn mode keeps tool results independent and navigable", async ({ page, request }) => {
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

  const rows = page.locator("[data-turn-id]");
  await expect(rows).toHaveCount(detail.turns.length);
  expect(await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-turn-id")))).toEqual(
    detail.turns.map((turn: { id: string }) => turn.id),
  );

  const activityButton = page.getByRole("button", { name: /Tool activity.*lookup_order/ });
  const activity = page.locator(`[data-turn-id="${callTurn.id}"] [data-tool-activity]`);
  const resultRow = page.locator(`[data-turn-id="${resultTurn.id}"]`);

  // The first labelable target is the assistant call. Its arguments are exposed automatically,
  // while the matching result remains a separate source turn rather than nested activity.
  await expect(activityButton).toHaveAttribute("aria-expanded", "true");
  await expect(activity).toContainText('"order_id":"42"');
  await expect(resultRow).toContainText("status:");
  await expect(resultRow).toHaveAttribute("data-labelable", "true");
  await expect(activity).not.toContainText("status:");

  // j follows labelable source turns, so the independently labelable tool result becomes active.
  await page.keyboard.press("j");
  await expect(page.getByText(`target: turn #${resultTurn.idx}`, { exact: true })).toBeVisible();
  await expect(resultRow).toHaveAttribute("data-active", "true");
  await expect(activityButton).toHaveAttribute("aria-expanded", "false");

  // Clicking and annotating the tool row writes an annotation for the tool turn's own target id.
  await resultRow.click();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const refreshed = await (
        await request.get(`${TURN_BASE_URL}/api/traces/${traceId}`)
      ).json();
      return refreshed.annotations[resultTurn.id]?.values?.verdict;
    })
    .toBe("pass");
});
