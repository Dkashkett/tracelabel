import { describe, expect, it } from "vitest";
import type { Turn } from "@/api/types";
import { groupToolInteractions } from "./turnGroups";

function turn(overrides: Partial<Turn> & Pick<Turn, "id" | "idx" | "role">): Turn {
  return {
    content: overrides.id,
    content_type: "text",
    labelable: overrides.role === "assistant",
    metadata: {},
    ...overrides,
  };
}

describe("groupToolInteractions", () => {
  it("nests a matched tool result beneath its assistant call", () => {
    const assistant = turn({
      id: "t#0",
      idx: 0,
      role: "assistant",
      tool_calls: [{ id: "call_1", name: "search", arguments: '{"q":"x"}' }],
    });
    const result = turn({
      id: "t#1",
      idx: 1,
      role: "tool",
      tool_call_id: "call_1",
    });

    const groups = groupToolInteractions([assistant, result]);
    expect(groups).toHaveLength(1);
    expect(groups[0].turn).toBe(assistant);
    expect(groups[0].toolInteractions[0].result).toBe(result);
  });

  it("normalizes canonical function calls without changing the source turn", () => {
    const canonicalCall = {
      id: "call_1",
      type: "function",
      function: { name: "search", arguments: '{"q":"x"}' },
    };
    const assistant = turn({
      id: "t#0",
      idx: 0,
      role: "assistant",
      tool_calls: [canonicalCall],
    });

    const [group] = groupToolInteractions([assistant]);
    expect(group.toolInteractions[0].call).toEqual({
      id: "call_1",
      name: "search",
      arguments: '{"q":"x"}',
    });
    expect(assistant.tool_calls?.[0]).toBe(canonicalCall);
  });

  it("pairs multiple calls by exact id while preserving call order", () => {
    const assistant = turn({
      id: "t#0",
      idx: 0,
      role: "assistant",
      tool_calls: [
        { id: "a", name: "first", arguments: "1" },
        { id: "b", name: "second", arguments: "2" },
      ],
    });
    const resultB = turn({ id: "t#1", idx: 1, role: "tool", tool_call_id: "b" });
    const resultA = turn({ id: "t#2", idx: 2, role: "tool", tool_call_id: "a" });

    const [group] = groupToolInteractions([assistant, resultB, resultA]);
    expect(group.toolInteractions.map(({ call }) => call.name)).toEqual(["first", "second"]);
    expect(group.toolInteractions.map(({ result }) => result?.id)).toEqual(["t#2", "t#1"]);
  });

  it("keeps a call with no result as a collapsed-capable interaction", () => {
    const assistant = turn({
      id: "t#0",
      idx: 0,
      role: "assistant",
      tool_calls: [{ id: "missing", name: "lookup", arguments: "{}" }],
    });

    const [group] = groupToolInteractions([assistant]);
    expect(group.toolInteractions).toHaveLength(1);
    expect(group.toolInteractions[0].result).toBeNull();
  });

  it("leaves unmatched and out-of-order result turns visible as standalone groups", () => {
    const earlyResult = turn({
      id: "t#0",
      idx: 0,
      role: "tool",
      tool_call_id: "future",
    });
    const assistant = turn({
      id: "t#1",
      idx: 1,
      role: "assistant",
      tool_calls: [{ id: "future", name: "later", arguments: "{}" }],
    });

    const groups = groupToolInteractions([earlyResult, assistant]);
    expect(groups.map(({ turn: item }) => item.id)).toEqual(["t#0", "t#1"]);
    expect(groups[1].toolInteractions[0].result).toBeNull();
  });

  it("preserves surrounding top-level trace order", () => {
    const user = turn({ id: "t#0", idx: 0, role: "user" });
    const assistant = turn({
      id: "t#1",
      idx: 1,
      role: "assistant",
      tool_calls: [{ id: "c", name: "tool", arguments: "{}" }],
    });
    const result = turn({ id: "t#2", idx: 2, role: "tool", tool_call_id: "c" });
    const followup = turn({ id: "t#3", idx: 3, role: "assistant" });

    expect(groupToolInteractions([user, assistant, result, followup]).map((g) => g.turn.id)).toEqual([
      "t#0",
      "t#1",
      "t#3",
    ]);
  });
});
