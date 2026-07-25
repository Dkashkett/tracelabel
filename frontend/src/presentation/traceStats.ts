import type { Turn } from "@/api/types";

export interface TraceStats {
  durationMs: number | null;
  messageCount: number;
  toolCallCount: number;
  agents: string[];
  errorCount: number;
}

/**
 * Client-side header metrics (06 §4): no waterfall, just chips. Duration is the span from the
 * earliest `started_at` to the latest `started_at + duration_ms` — omitted entirely when a trace
 * carries no timing (most imports today), rather than showing a misleading zero.
 */
export function deriveTraceStats(turns: Turn[]): TraceStats {
  const messageCount = turns.filter((t) => t.role !== "event").length;
  const toolCallCount = turns.reduce((n, t) => n + (t.tool_calls?.length ?? 0), 0);
  const agents = Array.from(new Set(turns.map((t) => t.agent).filter((a): a is string => Boolean(a))));
  const errorCount = turns.filter((t) => t.status === "error").length;

  const starts: number[] = [];
  const ends: number[] = [];
  for (const t of turns) {
    if (!t.started_at) continue;
    const start = Date.parse(t.started_at);
    if (Number.isNaN(start)) continue;
    starts.push(start);
    ends.push(typeof t.duration_ms === "number" ? start + t.duration_ms : start);
  }
  const durationMs = starts.length ? Math.max(...ends) - Math.min(...starts) : null;

  return { durationMs, messageCount, toolCallCount, agents, errorCount };
}
