import { describe, expect, it } from "vitest";
import type { ResolvedField } from "@/api/types";
import {
  fieldValueTruthy,
  initialNavState,
  navReducer,
  primarySelect,
  queueCounts,
  queueIsComplete,
  validateDraft,
  type NavState,
} from "./navReducer";

const base = (): NavState => initialNavState(true);

describe("navReducer", () => {
  it("seeds a draft on LOAD_TARGET and carries prefill provenance", () => {
    const s = navReducer(base(), {
      type: "LOAD_TARGET",
      draft: { verdict: "pass" },
      prefillModel: "gpt-4o-mini",
    });
    expect(s.draft).toEqual({ verdict: "pass" });
    expect(s.prefillModel).toBe("gpt-4o-mini");
  });

  it("keeps prefillModel when a prefilled field is edited (06 §5)", () => {
    let s = navReducer(base(), { type: "LOAD_TARGET", draft: { verdict: "pass" }, prefillModel: "m" });
    s = navReducer(s, { type: "SET_FIELD", name: "verdict", value: "fail" });
    expect(s.draft.verdict).toBe("fail");
    expect(s.prefillModel).toBe("m");
  });

  it("nulls prefillModel only on an explicit CLEAR_DRAFT", () => {
    let s = navReducer(base(), { type: "LOAD_TARGET", draft: { verdict: "pass" }, prefillModel: "m" });
    s = navReducer(s, { type: "CLEAR_DRAFT" });
    expect(s.draft).toEqual({});
    expect(s.prefillModel).toBeNull();
  });

  it("toggles multi_select values in place", () => {
    let s = navReducer(base(), { type: "TOGGLE_MULTI", name: "modes", option: "a" });
    expect(s.draft.modes).toEqual(["a"]);
    s = navReducer(s, { type: "TOGGLE_MULTI", name: "modes", option: "b" });
    expect(s.draft.modes).toEqual(["a", "b"]);
    s = navReducer(s, { type: "TOGGLE_MULTI", name: "modes", option: "a" });
    expect(s.draft.modes).toEqual(["b"]);
  });

  it("resets the active turn when the trace changes", () => {
    let s = navReducer(base(), { type: "SET_ACTIVE_TURN", idx: 4 });
    s = navReducer(s, { type: "SET_TRACE", idx: 2 });
    expect(s.traceIdx).toBe(2);
    expect(s.turnIdx).toBeNull();
  });

  it("toggles auto-advance", () => {
    const s = navReducer(base(), { type: "TOGGLE_AUTO_ADVANCE" });
    expect(s.autoAdvance).toBe(false);
  });

  it("enters the finished screen and restores review mode at a selected trace", () => {
    let s = navReducer(base(), { type: "SHOW_FINISHED" });
    expect(s.workflow).toBe("finished");
    s = navReducer(s, { type: "REVIEW_TRACE", idx: 3 });
    expect(s.workflow).toBe("review");
    expect(s.traceIdx).toBe(3);
    expect(s.turnIdx).toBeNull();
  });

  it("keeps the active turn when reviewing the trace already on screen", () => {
    let s = navReducer(base(), { type: "SET_ACTIVE_TURN", idx: 4 });
    s = navReducer(s, { type: "SHOW_FINISHED" });
    s = navReducer(s, { type: "REVIEW_TRACE", idx: 0 });
    expect(s.turnIdx).toBe(4);
  });
});

describe("queue completion", () => {
  const entry = (overrides: Partial<{ n_targets: number; n_labeled: number; n_skipped: number }>) => ({
    trace_id: "trace",
    position: 0,
    n_targets: 2,
    n_labeled: 0,
    n_skipped: 0,
    ...overrides,
  });

  it("requires every queue target to be labeled or skipped", () => {
    expect(
      queueIsComplete([
        entry({ n_labeled: 1, n_skipped: 1 }),
        { ...entry({ n_targets: 1, n_labeled: 0 }), trace_id: "unfinished", position: 1 },
      ]),
    ).toBe(false);
    expect(
      queueIsComplete([
        entry({ n_labeled: 1, n_skipped: 1 }),
        { ...entry({ n_targets: 1, n_skipped: 1 }), trace_id: "done", position: 1 },
      ]),
    ).toBe(true);
  });

  it("totals labeled, skipped, and target counts", () => {
    expect(
      queueCounts([
        entry({ n_labeled: 1, n_skipped: 1 }),
        { ...entry({ n_targets: 3, n_labeled: 2, n_skipped: 1 }), position: 1 },
      ]),
    ).toEqual({ labeled: 3, skipped: 2, total: 5 });
  });
});

const F = {
  singleReq: { name: "verdict", label: "Verdict", type: "single_select", required: true, options: ["pass", "fail"] },
  singleOpt: { name: "tone", label: "Tone", type: "single_select", required: false, options: ["ok"] },
  multi: { name: "modes", label: "Modes", type: "multi_select", required: false, options: ["a", "b"] },
  text: { name: "why", label: "Why", type: "text", required: true },
} satisfies Record<string, ResolvedField>;

describe("primarySelect (06 §2.1)", () => {
  it("prefers the first required single_select", () => {
    expect(primarySelect([F.text, F.multi, F.singleReq])?.name).toBe("verdict");
  });
  it("falls back to the first select of any kind", () => {
    expect(primarySelect([F.text, F.multi, F.singleOpt])?.name).toBe("modes");
  });
  it("returns null when there is no select", () => {
    expect(primarySelect([F.text])).toBeNull();
  });
});

describe("validateDraft (05 §3 required half)", () => {
  it("flags a missing required field", () => {
    expect(validateDraft([F.singleReq], {})).toHaveProperty("verdict");
  });
  it("passes when the required field is present", () => {
    expect(validateDraft([F.singleReq], { verdict: "pass" })).toEqual({});
  });
  it("treats an empty multi_select and whitespace text as missing", () => {
    expect(fieldValueTruthy([])).toBe(false);
    expect(fieldValueTruthy("   ")).toBe(false);
    expect(fieldValueTruthy("x")).toBe(true);
    expect(fieldValueTruthy(["a"])).toBe(true);
  });
});
