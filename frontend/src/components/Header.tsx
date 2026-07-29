import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { formatDuration } from "@/lib/format";
import { deriveTraceStats } from "@/presentation/traceStats";
import { useController } from "@/state/NavContext";

function TraceStatsChips() {
  const { trace } = useController();
  const stats = useMemo(() => deriveTraceStats(trace.turns), [trace.turns]);
  if (trace.document) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-faint">
      {stats.durationMs !== null && stats.durationMs > 0 && (
        <span className="rounded-full bg-surface-raised px-2 py-0.5 tabular-nums">
          {formatDuration(stats.durationMs)}
        </span>
      )}
      <span className="rounded-full bg-surface-raised px-2 py-0.5 tabular-nums">
        {stats.messageCount} msg
      </span>
      {stats.toolCallCount > 0 && (
        <span className="rounded-full bg-surface-raised px-2 py-0.5 tabular-nums">
          {stats.toolCallCount} tool
        </span>
      )}
      {stats.agents.length > 0 && (
        <span
          className="truncate rounded-full bg-surface-raised px-2 py-0.5"
          title={stats.agents.join(", ")}
        >
          {stats.agents.length} agent{stats.agents.length === 1 ? "" : "s"}
        </span>
      )}
      {stats.errorCount > 0 && (
        <span className="rounded-full bg-fail/15 px-2 py-0.5 font-medium tabular-nums text-fail">
          {stats.errorCount} error{stats.errorCount === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

export function Header() {
  const { project } = useParams<{ project: string }>();
  const { session, completionCounts, canGoBack, goBack, setCheatOpen } = useController();

  const { total, labeled, skipped } = completionCounts;
  const done = labeled + skipped;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <header className="flex items-center gap-4 border-b border-line bg-surface/80 px-5 py-2.5 text-sm text-ink backdrop-blur">
      <nav className="flex items-center gap-1.5 font-semibold tracking-tight">
        <Link to="/" className="text-ink-muted hover:text-ink">
          tracelabel
        </Link>
        <span className="text-ink-faint">/</span>
        <Link to={`/p/${project}`} className="text-ink-muted hover:text-ink">
          {project}
        </Link>
        <span className="text-ink-faint">/</span>
        <span>{session.task}</span>
      </nav>
      <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {session.level}
      </span>
      <TraceStatsChips />

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-medium tabular-nums text-ink-muted">
          {done}/{total}
        </span>
      </div>

      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack}
        title="back to previous target (u)"
        className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
      >
        ↩ Prev
      </button>
      <button
        type="button"
        onClick={() => setCheatOpen(true)}
        className="rounded-lg px-2 py-1 text-ink-muted transition-colors hover:bg-surface-raised"
        title="keyboard shortcuts (?)"
      >
        ?
      </button>
    </header>
  );
}
