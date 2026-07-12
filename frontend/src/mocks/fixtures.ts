import type { Api } from "@/api/client";
import type {
  AnnotationIn,
  AnnotationOut,
  Progress,
  QueueEntry,
  SessionInfo,
  TraceDetail,
  Turn,
} from "@/api/types";

const NOW = "2026-07-01T12:00:00Z";

const session: SessionInfo = {
  task: "answer-quality",
  level: "turn",
  fields: [
    {
      name: "verdict",
      label: "Verdict",
      type: "single_select",
      required: true,
      options: ["pass", "fail"],
      help: "Did the turn accomplish its goal?",
    },
    {
      name: "failure_modes",
      label: "Failure modes",
      type: "multi_select",
      required: false,
      options: ["hallucination", "tool_error", "refusal", "verbosity"],
    },
    {
      name: "reasoning",
      label: "Reasoning",
      type: "text",
      required: false,
      placeholder: "Optional notes on why…",
    },
  ],
  label_roles: ["assistant", "document"],
  annotator: "dan",
  schema_hash: "sha256:demo0000",
  shuffle: false,
};

function turn(t: Partial<Turn> & Pick<Turn, "id" | "idx" | "role" | "content">): Turn {
  return {
    content_type: "text",
    labelable: t.role === "assistant" || t.role === "document",
    metadata: {},
    ...t,
  };
}

// ── Trace 1: a tool-using conversation (suggestion + one existing annotation) ──
const tTool: TraceDetail = {
  trace: { id: "t_tool", source: "demo", metadata: { scenario: "weather" } },
  turns: [
    turn({ id: "t_tool#0", idx: 0, role: "system", content: "You are a helpful assistant." }),
    turn({ id: "t_tool#1", idx: 1, role: "user", content: "What's the weather in San Francisco?" }),
    turn({
      id: "t_tool#2",
      idx: 2,
      role: "assistant",
      content: "Let me look that up for you.",
      tool_calls: [
        { id: "call_1", name: "get_weather", arguments: '{"city": "San Francisco", "units": "imperial"}' },
      ],
    }),
    turn({
      id: "t_tool#3",
      idx: 3,
      role: "tool",
      content: '{"temp_f": 61, "conditions": "Foggy", "humidity": 0.84}',
      content_type: "json",
      tool_call_id: "call_1",
      name: "get_weather",
    }),
    turn({
      id: "t_tool#4",
      idx: 4,
      role: "assistant",
      content: "It's currently 61°F and foggy in San Francisco.",
    }),
  ],
  annotations: {
    "t_tool#4": {
      target_type: "turn",
      target_id: "t_tool#4",
      status: "labeled",
      values: { verdict: "pass", reasoning: "Accurate summary of the tool result." },
      prefill_model: null,
      schema_hash: session.schema_hash,
      annotator: session.annotator,
      created_at: NOW,
      updated_at: NOW,
    },
  },
  suggestions: {
    "t_tool#2": {
      target_id: "t_tool#2",
      values: { verdict: "pass" },
      model: "gpt-4o-mini",
      created_at: NOW,
    },
  },
};

// ── Trace 2: a mixed-parts document ──
const tParts: TraceDetail = {
  trace: { id: "t_parts", source: "demo", metadata: {} },
  turns: [
    turn({
      id: "t_parts#0",
      idx: 0,
      role: "document",
      content_type: "parts",
      content: JSON.stringify([
        { type: "text", text: "I found this record in the database:" },
        { type: "json", json_string: '{"user_id": 42, "active": true, "roles": ["admin", "editor"]}' },
        { type: "html", html: "<p>Rendered as a <b>fragment</b> with a <a href='#'>link</a>.</p>" },
      ]),
    }),
  ],
  annotations: {},
  suggestions: {},
};

// ── Trace 3: an HTML document (sandbox proof: the inline script must not run) ──
const tHtml: TraceDetail = {
  trace: { id: "t_html", source: "demo", metadata: {} },
  turns: [
    turn({
      id: "t_html#0",
      idx: 0,
      role: "document",
      content_type: "html",
      content:
        "<!doctype html><html><body><h1>Quarterly Report</h1>" +
        "<p>Revenue up <strong>12%</strong> QoQ.</p>" +
        "<script>document.body.innerHTML = 'ESCAPED SANDBOX';</script>" +
        "</body></html>",
    }),
  ],
  annotations: {},
  suggestions: {},
};

// ── Trace 4: 300 turns, to exercise virtualization ──
function bigTrace(): TraceDetail {
  const turns: Turn[] = [];
  for (let i = 0; i < 300; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    const isJson = i === 51;
    turns.push(
      turn({
        id: `t_big#${i}`,
        idx: i,
        role,
        content: isJson
          ? '{"step": 51, "state": "searching", "candidates": [1, 2, 3]}'
          : `${role === "user" ? "User" : "Assistant"} message #${i}. ` +
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        content_type: isJson ? "json" : "text",
      }),
    );
  }
  return {
    trace: { id: "t_big", source: "demo", metadata: { note: "long thread" } },
    turns,
    annotations: {},
    suggestions: {},
  };
}

const traces: Record<string, TraceDetail> = {
  t_tool: tTool,
  t_parts: tParts,
  t_html: tHtml,
  t_big: bigTrace(),
};
const order = ["t_tool", "t_parts", "t_html", "t_big"];

function traceIdOf(targetId: string): string {
  return targetId.includes("#") ? targetId.slice(0, targetId.indexOf("#")) : targetId;
}

function targetsOf(td: TraceDetail): string[] {
  if (session.level === "trace") return [td.trace.id];
  return td.turns.filter((t) => t.labelable).map((t) => t.id);
}

function queueEntry(traceId: string, position: number): QueueEntry {
  const td = traces[traceId];
  const targets = targetsOf(td);
  let labeled = 0;
  let skipped = 0;
  for (const id of targets) {
    const a = td.annotations[id];
    if (a?.status === "labeled") labeled++;
    else if (a?.status === "skipped") skipped++;
  }
  return {
    trace_id: traceId,
    position,
    n_targets: targets.length,
    n_labeled: labeled,
    n_skipped: skipped,
  };
}

// Simulated latency keeps the optimistic-advance path honest in the mock.
const delay = <T>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 60));

// Deep-ish clone so consumers can't mutate the mock store except through putAnnotation.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const mockApi: Api = {
  getSession: () => delay(clone(session)),
  getQueue: () => delay(order.map(queueEntry)),
  getTrace: (traceId) => {
    const td = traces[traceId];
    if (!td) return Promise.reject(new Error(`unknown trace '${traceId}'`));
    return delay(clone(td));
  },
  putAnnotation: (ann: AnnotationIn) => {
    const td = traces[traceIdOf(ann.target_id)];
    if (!td) return Promise.reject(new Error(`unknown target '${ann.target_id}'`));
    const prev = td.annotations[ann.target_id];
    const out: AnnotationOut = {
      ...ann,
      values: ann.status === "skipped" ? {} : ann.values,
      prefill_model: ann.prefill_model ?? null,
      schema_hash: session.schema_hash,
      annotator: session.annotator,
      created_at: prev?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    td.annotations[ann.target_id] = out;
    return delay(clone(out));
  },
  getProgress: (): Promise<Progress> => {
    let total = 0;
    let labeled = 0;
    let skipped = 0;
    for (const id of order) {
      const e = queueEntry(id, 0);
      total += e.n_targets;
      labeled += e.n_labeled;
      skipped += e.n_skipped;
    }
    return delay({ unit: "turns", total, labeled, skipped });
  },
};
