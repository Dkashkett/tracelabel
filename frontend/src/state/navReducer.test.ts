import { describe, expect, it } from "vitest";
import type { ResolvedField } from "@/api/types";
import {
  fieldValueTruthy,
  initialNavState,
  navReducer,
  primarySelect,
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
