import { describe, expect, it } from "vitest";
import type { Turn } from "@/api/types";
import { deriveTraceStats } from "./traceStats";

function turn(overrides: Partial<Turn> & Pick<Turn, "id" | "idx" | "role">): Turn {
  return {
    content: overrides.id,
    content_type: "text",
    labelable: false,
    metadata: {},
    ...overrides,
  };
}

describe("deriveTraceStats", () => {
  it("counts messages (excluding event rows), tool calls, agents, and errors", () => {
    const turns = [
      turn({ id: "t#0", idx: 0, role: "user" }),
      turn({
        id: "t#1",
        idx: 1,
        role: "assistant",
        agent: "Researcher",
        tool_calls: [{ id: "c1", name: "search", arguments: "{}" }],
      }),
      turn({ id: "t#2", idx: 2, role: "tool", tool_call_id: "c1", status: "error" }),
      turn({ id: "t#3", idx: 3, role: "event", kind: "span", content: "" }),
    ];
    const stats = deriveTraceStats(turns);
    expect(stats.messageCount).toBe(3);
    expect(stats.toolCallCount).toBe(1);
    expect(stats.agents).toEqual(["Researcher"]);
    expect(stats.errorCount).toBe(1);
  });

  it("omits duration when no turn carries a started_at timestamp", () => {
    const turns = [turn({ id: "t#0", idx: 0, role: "user" })];
    expect(deriveTraceStats(turns).durationMs).toBeNull();
  });

  it("spans from the earliest start to the latest start+duration", () => {
    const turns = [
      turn({ id: "t#0", idx: 0, role: "assistant", started_at: "2026-01-01T00:00:00.000Z" }),
      turn({
        id: "t#1",
        idx: 1,
        role: "tool",
        started_at: "2026-01-01T00:00:01.000Z",
        duration_ms: 500,
      }),
    ];
    expect(deriveTraceStats(turns).durationMs).toBe(1500);
  });
});
