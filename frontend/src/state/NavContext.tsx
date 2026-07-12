import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { qk, useProgress, useQueue, useSession, useTrace, usePutAnnotation } from "@/api/queries";
import type {
  AnnotationIn,
  Progress,
  QueueEntry,
  ResolvedField,
  SessionInfo,
  TraceDetail,
  Turn,
} from "@/api/types";
import {
  fieldValueTruthy,
  initialNavState,
  navReducer,
  queueCounts,
  queueIsComplete,
  validateDraft,
  type Draft,
  type NavAction,
  type NavState,
} from "./navReducer";
import { getAutoAdvance, setAutoAdvance } from "./prefs";

export interface Target {
  type: "turn" | "trace";
  id: string;
  turnIdx: number | null;
}

export interface Controller {
  session: SessionInfo;
  queue: QueueEntry[];
  trace: TraceDetail;
  progress: Progress | undefined;
  state: NavState;
  errors: Record<string, string>;
  labelableTurns: Turn[];
  activeTarget: Target | null;
  activeTurn: Turn | null;
  commitPending: boolean;
  savedTargetId: string | null;
  cheatOpen: boolean;
  drawerOpen: boolean;
  isFinished: boolean;
  completionCounts: { labeled: number; skipped: number; total: number };
  dispatch: React.Dispatch<NavAction>;
  setCheatOpen: (open: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  focusTurnByIdx: (idx: number) => void;
  nextTurn: () => void;
  prevTurn: () => void;
  nextTrace: () => void;
  prevTrace: () => void;
  goToTrace: (idx: number) => void;
  setField: (name: string, value: string | string[]) => void;
  toggleMulti: (name: string, option: string) => void;
  clearDraft: () => void;
  focusFirstText: () => void;
  commit: () => void;
  skip: () => void;
  prevTarget: () => void;
  toggleAutoAdvance: () => void;
  setPeek: (on: boolean) => void;
}

const Ctx = createContext<Controller | null>(null);

export function useController(): Controller {
  const c = useContext(Ctx);
  if (!c) throw new Error("useController must be used within a NavProvider");
  return c;
}

function targetsOf(td: TraceDetail, level: SessionInfo["level"]): Target[] {
  if (level === "trace") return [{ type: "trace", id: td.trace.id, turnIdx: null }];
  return td.turns.filter((t) => t.labelable).map((t) => ({ type: "turn", id: t.id, turnIdx: t.idx }));
}

function isAddressed(td: TraceDetail, id: string, committedId?: string): boolean {
  return id === committedId || !!td.annotations[id];
}

// Drop empty optional fields so the payload carries only what the labeler set (06 §5).
function cleanValues(fields: ResolvedField[], draft: Draft): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const f of fields) {
    const v = draft[f.name];
    if (v === undefined) continue;
    if (!f.required && !fieldValueTruthy(v)) continue;
    out[f.name] = v;
  }
  return out;
}

export function NavProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const sessionQ = useSession();
  const queueQ = useQueue();
  const progressQ = useProgress();
  const putMutation = usePutAnnotation();

  const [state, dispatch] = useReducer(navReducer, undefined, () =>
    initialNavState(getAutoAdvance()),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cheatOpen, setCheatOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedTargetId, setSavedTargetId] = useState<string | null>(null);

  const session = sessionQ.data;
  const queue = queueQ.data;
  const currentTraceId = queue?.[state.traceIdx]?.trace_id;
  const traceQ = useTrace(currentTraceId);
  const trace = traceQ.data;
  const datasetComplete = !!queue && queueIsComplete(queue);
  const isFinished =
    state.workflow === "finished" ||
    (state.workflow === "labeling" && datasetComplete);

  const level = session?.level ?? "turn";
  const labelableTurns = useMemo(
    () => (trace ? trace.turns.filter((t) => t.labelable) : []),
    [trace],
  );
  const targets: Target[] = trace ? targetsOf(trace, level) : [];
  const activeTarget =
    level === "trace"
      ? (targets[0] ?? null)
      : (targets.find((t) => t.turnIdx === state.turnIdx) ?? null);
  const activeTurn = trace?.turns.find((t) => t.idx === state.turnIdx) ?? null;
  const activeId = activeTarget?.id ?? null;

  // On entering a trace, focus its first labelable target (or clear for trace-level).
  useEffect(() => {
    if (!session || !trace) return;
    if (session.level === "trace") {
      if (state.turnIdx !== null) dispatch({ type: "SET_ACTIVE_TURN", idx: null });
      return;
    }
    const labelable = trace.turns.filter((t) => t.labelable);
    if (!labelable.some((t) => t.idx === state.turnIdx)) {
      dispatch({ type: "SET_ACTIVE_TURN", idx: labelable[0]?.idx ?? null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace?.trace.id, session?.level]);

  // Seed the draft when the active target changes: annotation wins, else suggestion, else empty.
  useEffect(() => {
    if (!trace || !activeId) return;
    const ann = trace.annotations[activeId];
    const sug = trace.suggestions[activeId];
    if (ann) {
      dispatch({ type: "LOAD_TARGET", draft: { ...ann.values }, prefillModel: ann.prefill_model ?? null });
    } else if (sug) {
      dispatch({ type: "LOAD_TARGET", draft: { ...sug.values }, prefillModel: sug.model });
    } else {
      dispatch({ type: "LOAD_TARGET", draft: {}, prefillModel: null });
    }
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, trace?.trace.id]);

  useEffect(() => {
    setAutoAdvance(state.autoAdvance);
  }, [state.autoAdvance]);

  // Derive completion from persisted queue counts. Review mode intentionally suppresses this so
  // choosing a trace from the finished screen restores an editable workspace.
  useEffect(() => {
    if (state.workflow === "labeling" && datasetComplete) {
      setDrawerOpen(false);
      dispatch({ type: "SHOW_FINISHED" });
    }
  }, [datasetComplete, state.workflow]);

  const fetchTrace = (id: string) =>
    qc.fetchQuery({ queryKey: qk.trace(id), queryFn: () => api.getTrace(id) });

  const invalidateAfterWrite = (traceId: string) => {
    void qc.invalidateQueries({ queryKey: qk.trace(traceId) });
    void qc.invalidateQueries({ queryKey: qk.queue });
    void qc.invalidateQueries({ queryKey: qk.progress });
    const next = queue?.[state.traceIdx + 1]?.trace_id;
    if (next) void qc.prefetchQuery({ queryKey: qk.trace(next), queryFn: () => api.getTrace(next) });
  };

  // Next unaddressed target in queue order, wrapping once at the physical end (06 §2.2).
  async function advance(committedId?: string) {
    if (!session || !queue || !trace) return;

    const activate = (traceIdx: number, target: Target) => {
      if (traceIdx !== state.traceIdx) dispatch({ type: "SET_TRACE", idx: traceIdx });
      dispatch({ type: "SET_ACTIVE_TURN", idx: target.turnIdx });
    };
    const firstUnaddressed = (td: TraceDetail, candidates: Target[]) =>
      candidates.find((target) => !isAddressed(td, target.id, committedId));

    const currentTargets = targetsOf(trace, session.level);
    const currentTargetIdx = currentTargets.findIndex((target) => target.id === activeTarget?.id);
    const afterCurrent = currentTargets.slice(Math.max(0, currentTargetIdx + 1));
    const nextHere = firstUnaddressed(trace, afterCurrent);
    if (nextHere) {
      activate(state.traceIdx, nextHere);
      return;
    }

    const scanTrace = async (traceIdx: number): Promise<boolean> => {
      const entry = queue[traceIdx];
      if (entry.n_labeled + entry.n_skipped >= entry.n_targets) return false;
      const td = await fetchTrace(entry.trace_id);
      const next = firstUnaddressed(td, targetsOf(td, session.level));
      if (!next) return false;
      activate(traceIdx, next);
      return true;
    };

    for (let j = state.traceIdx + 1; j < queue.length; j++) {
      if (await scanTrace(j)) return;
    }
    for (let j = 0; j < state.traceIdx; j++) {
      if (await scanTrace(j)) return;
    }

    // The wrap ends with targets earlier in the current trace.
    const beforeCurrent = currentTargets.slice(0, Math.max(0, currentTargetIdx));
    const wrappedHere = firstUnaddressed(trace, beforeCurrent);
    if (wrappedHere) activate(state.traceIdx, wrappedHere);
    // No target found: stay put until a successful write refreshes queue completion counts.
  }

  const focusTurnByIdx = (idx: number) => dispatch({ type: "SET_ACTIVE_TURN", idx });

  const stepTurn = (dir: 1 | -1) => {
    if (!trace) return;
    const labelable = trace.turns.filter((t) => t.labelable);
    const i = labelable.findIndex((t) => t.idx === state.turnIdx);
    const next = i + dir;
    if (next >= 0 && next < labelable.length) focusTurnByIdx(labelable[next].idx);
  };

  const goToTrace = (idx: number) => {
    if (!queue?.length) return;
    const clamped = Math.max(0, Math.min(queue.length - 1, idx));
    if (isFinished) {
      dispatch({ type: "REVIEW_TRACE", idx: clamped });
      return;
    }
    if (clamped !== state.traceIdx) dispatch({ type: "SET_TRACE", idx: clamped });
  };

  function commit() {
    if (!session || !activeTarget || !trace) return;
    const errs = validateDraft(session.fields, state.draft);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    const traceId = trace.trace.id;
    const ann: AnnotationIn = {
      target_type: activeTarget.type,
      target_id: activeTarget.id,
      status: "labeled",
      values: cleanValues(session.fields, state.draft),
      prefill_model: state.prefillModel,
    };
    dispatch({ type: "SET_MODE", mode: "NAV" });
    (document.activeElement as HTMLElement | null)?.blur?.();
    putMutation.mutate(ann, {
      onSuccess: (out) => {
        setSavedTargetId(out.target_id); // ●saved flips only on settle (06 §2.3)
        invalidateAfterWrite(traceId);
      },
    });
    if (state.autoAdvance) void advance(activeTarget.id); // optimistic move (<100ms, 09 §3)
  }

  function skip() {
    if (!session || !activeTarget || !trace) return;
    setErrors({});
    const traceId = trace.trace.id;
    const ann: AnnotationIn = {
      target_type: activeTarget.type,
      target_id: activeTarget.id,
      status: "skipped",
      values: {},
      prefill_model: null,
    };
    dispatch({ type: "SET_MODE", mode: "NAV" });
    putMutation.mutate(ann, {
      onSuccess: (out) => {
        setSavedTargetId(out.target_id);
        invalidateAfterWrite(traceId);
      },
    });
    void advance(activeTarget.id); // skip always advances (06 §2)
  }

  async function prevTarget() {
    if (!session || !queue || !trace) return;
    if (session.level === "turn") {
      const labelable = trace.turns.filter((t) => t.labelable);
      const i = labelable.findIndex((t) => t.idx === state.turnIdx);
      if (i > 0) {
        focusTurnByIdx(labelable[i - 1].idx);
        return;
      }
    }
    for (let j = state.traceIdx - 1; j >= 0; j--) {
      const td = await fetchTrace(queue[j].trace_id);
      const tgts = targetsOf(td, session.level);
      if (tgts.length) {
        const last = tgts[tgts.length - 1];
        dispatch({ type: "SET_TRACE", idx: j });
        dispatch({ type: "SET_ACTIVE_TURN", idx: last.turnIdx });
        return;
      }
    }
  }

  const focusFirstText = () => {
    if (!session) return;
    const first = session.fields.find((f) => f.type === "text");
    if (!first) return;
    dispatch({ type: "SET_MODE", mode: "FIELD" });
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>(`[data-field-name="${first.name}"] textarea`)
        ?.focus();
    });
  };

  if (sessionQ.isError || queueQ.isError || traceQ.isError) {
    const err = sessionQ.error ?? queueQ.error ?? traceQ.error;
    return (
      <div className="grid h-screen place-items-center p-8 text-center text-sm text-red-600">
        Failed to load: {err instanceof Error ? err.message : "unknown error"}
      </div>
    );
  }
  if (!session || !queue || !trace) {
    return (
      <div className="grid h-screen place-items-center text-sm text-slate-500">Loading…</div>
    );
  }

  const controller: Controller = {
    session,
    queue,
    trace,
    progress: progressQ.data,
    state,
    errors,
    labelableTurns,
    activeTarget,
    activeTurn,
    commitPending: putMutation.isPending,
    savedTargetId,
    cheatOpen,
    drawerOpen,
    isFinished,
    completionCounts: queueCounts(queue),
    dispatch,
    setCheatOpen,
    setDrawerOpen,
    focusTurnByIdx,
    nextTurn: () => stepTurn(1),
    prevTurn: () => stepTurn(-1),
    nextTrace: () => goToTrace(state.traceIdx + 1),
    prevTrace: () => goToTrace(state.traceIdx - 1),
    goToTrace,
    setField: (name, value) => dispatch({ type: "SET_FIELD", name, value }),
    toggleMulti: (name, option) => dispatch({ type: "TOGGLE_MULTI", name, option }),
    clearDraft: () => dispatch({ type: "CLEAR_DRAFT" }),
    focusFirstText,
    commit,
    skip,
    prevTarget,
    toggleAutoAdvance: () => dispatch({ type: "TOGGLE_AUTO_ADVANCE" }),
    setPeek: (on) => dispatch({ type: "SET_PEEK", peek: on }),
  };

  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}
