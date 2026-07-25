import { describe, expect, it } from "vitest";
import type { Turn } from "@/api/types";
import { flattenPresentation } from "./agentSections";
import { groupToolInteractions } from "./turnGroups";

function turn(overrides: Partial<Turn> & Pick<Turn, "id" | "idx" | "role">): Turn {
  return {
    content: overrides.id,
    content_type: "text",
    labelable: false,
    metadata: {},
    ...overrides,
  };
}

describe("flattenPresentation", () => {
  it("emits no section headers or indentation for a plain trace with no agent field", () => {
    const turns = [
      turn({ id: "t#0", idx: 0, role: "user" }),
      turn({ id: "t#1", idx: 1, role: "assistant" }),
    ];
    const rows = flattenPresentation(groupToolInteractions(turns));
    expect(rows.map((r) => r.kind)).toEqual(["turn", "turn"]);
    expect(rows.every((r) => "indent" in r && r.indent === false)).toBe(true);
  });

  it("treats the first named agent as primary (no indent) and later agents as sub-agents (indented)", () => {
    const turns = [
      turn({ id: "t#0", idx: 0, role: "user" }),
      turn({ id: "t#1", idx: 1, role: "assistant", agent: "Orchestrator" }),
      turn({ id: "t#2", idx: 2, role: "assistant", agent: "Researcher" }),
      turn({ id: "t#3", idx: 3, role: "assistant", agent: "Orchestrator" }),
    ];
    const rows = flattenPresentation(groupToolInteractions(turns));
    expect(rows.map((r) => r.kind)).toEqual([
      "turn", // t#0, no agent
      "section-header", // entering Orchestrator (primary)
      "turn", // t#1
      "section-header", // entering Researcher (sub-agent)
      "turn", // t#2
      "section-header", // back to Orchestrator
      "turn", // t#3
    ]);
    const headers = rows.filter((r) => r.kind === "section-header");
    expect(headers.map((h) => (h.kind === "section-header" ? h.agent : null))).toEqual([
      "Orchestrator",
      "Researcher",
      "Orchestrator",
    ]);
    expect(headers.map((h) => h.indent)).toEqual([false, true, false]);

    const researcherTurn = rows.find(
      (r) => r.kind === "turn" && r.turn.id === "t#2",
    );
    expect(researcherTurn && "indent" in researcherTurn && researcherTurn.indent).toBe(true);
    const orchestratorTurn = rows.find(
      (r) => r.kind === "turn" && r.turn.id === "t#1",
    );
    expect(orchestratorTurn && "indent" in orchestratorTurn && orchestratorTurn.indent).toBe(false);
  });

  it("routes kind:handoff event rows to the handoff row type, other event kinds to event", () => {
    const turns = [
      turn({ id: "t#0", idx: 0, role: "event", kind: "handoff", content: "" }),
      turn({ id: "t#1", idx: 1, role: "event", kind: "retrieval", content: "" }),
    ];
    const rows = flattenPresentation(groupToolInteractions(turns));
    expect(rows.map((r) => r.kind)).toEqual(["handoff", "event"]);
  });

  it("does not indent a single-named-agent trace (that agent is primary throughout)", () => {
    const turns = [
      turn({ id: "t#0", idx: 0, role: "assistant", agent: "SupportBot" }),
      turn({ id: "t#1", idx: 1, role: "assistant", agent: "SupportBot" }),
    ];
    const rows = flattenPresentation(groupToolInteractions(turns));
    expect(rows.filter((r) => r.kind === "section-header")).toHaveLength(1);
    expect(rows.every((r) => "indent" in r && r.indent === false)).toBe(true);
  });
});
