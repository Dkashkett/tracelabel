import type { QueueEntry, ResolvedField } from "@/api/types";

export type Mode = "NAV" | "FIELD";
export type Workflow = "labeling" | "finished" | "review";
export type Draft = Record<string, string | string[]>;

// Exactly the shape in docs/design/06-frontend.md §6.
export interface NavState {
  traceIdx: number; // position in queue order
  turnIdx: number | null; // active labelable turn (turn level); null at trace level
  mode: Mode;
  draft: Draft; // form values before commit
  prefillModel: string | null;
  autoAdvance: boolean;
  peek: boolean;
  workflow: Workflow;
}

export type NavAction =
  | { type: "SET_TRACE"; idx: number }
  | { type: "SET_ACTIVE_TURN"; idx: number | null }
  | { type: "SET_MODE"; mode: Mode }
  | { type: "LOAD_TARGET"; draft: Draft; prefillModel: string | null }
  | { type: "SET_FIELD"; name: string; value: string | string[] }
  | { type: "TOGGLE_MULTI"; name: string; option: string }
  | { type: "CLEAR_DRAFT" }
  | { type: "TOGGLE_AUTO_ADVANCE" }
  | { type: "SET_PEEK"; peek: boolean }
  | { type: "SHOW_FINISHED" }
  | { type: "REVIEW_TRACE"; idx: number };

export function initialNavState(autoAdvance: boolean): NavState {
  return {
    traceIdx: 0,
    turnIdx: null,
    mode: "NAV",
    draft: {},
    prefillModel: null,
    autoAdvance,
    peek: false,
    workflow: "labeling",
  };
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "SET_TRACE":
      return { ...state, traceIdx: action.idx, turnIdx: null };
    case "SET_ACTIVE_TURN":
      return { ...state, turnIdx: action.idx };
    case "SET_MODE":
      return { ...state, mode: action.mode };
    case "LOAD_TARGET":
      // moving to a new target seeds the draft from its annotation/suggestion
      return { ...state, draft: action.draft, prefillModel: action.prefillModel };
    case "SET_FIELD":
      // editing keeps prefillModel — provenance survives edits (06 §5)
      return { ...state, draft: { ...state.draft, [action.name]: action.value } };
    case "TOGGLE_MULTI": {
      const cur = Array.isArray(state.draft[action.name])
        ? (state.draft[action.name] as string[])
        : [];
      const next = cur.includes(action.option)
        ? cur.filter((o) => o !== action.option)
        : [...cur, action.option];
      return { ...state, draft: { ...state.draft, [action.name]: next } };
    }
    case "CLEAR_DRAFT":
      // explicit clear zeroes prefill provenance (06 §5)
      return { ...state, draft: {}, prefillModel: null };
    case "TOGGLE_AUTO_ADVANCE":
      return { ...state, autoAdvance: !state.autoAdvance };
    case "SET_PEEK":
      return { ...state, peek: action.peek };
    case "SHOW_FINISHED":
      return { ...state, mode: "NAV", peek: false, workflow: "finished" };
    case "REVIEW_TRACE":
      return {
        ...state,
        traceIdx: action.idx,
        turnIdx: action.idx === state.traceIdx ? state.turnIdx : null,
        mode: "NAV",
        peek: false,
        workflow: "review",
      };
  }
}

export function queueIsComplete(queue: QueueEntry[]): boolean {
  return queue.every((entry) => entry.n_labeled + entry.n_skipped >= entry.n_targets);
}

export function queueCounts(queue: QueueEntry[]): {
  labeled: number;
  skipped: number;
  total: number;
} {
  return queue.reduce(
    (counts, entry) => ({
      labeled: counts.labeled + entry.n_labeled,
      skipped: counts.skipped + entry.n_skipped,
      total: counts.total + entry.n_targets,
    }),
    { labeled: 0, skipped: 0, total: 0 },
  );
}

export function isSelect(f: ResolvedField): boolean {
  return f.type === "single_select" || f.type === "multi_select";
}

// 06 §2.1: the primary select is the first required single_select in field order,
// else the first select of any kind. Digits act on it in NAV mode.
export function primarySelect(fields: ResolvedField[]): ResolvedField | null {
  return (
    fields.find((f) => f.required && f.type === "single_select") ??
    fields.find(isSelect) ??
    null
  );
}

export function fieldValueTruthy(v: string | string[] | undefined): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return false;
}

// Client mirror of the required-field half of the 05 §3 write-path check; the server
// remains authoritative. Returns field-name → message for each missing required field.
export function validateDraft(fields: ResolvedField[], draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.required && !fieldValueTruthy(draft[f.name])) {
      errors[f.name] = `${f.label} is required`;
    }
  }
  return errors;
}
