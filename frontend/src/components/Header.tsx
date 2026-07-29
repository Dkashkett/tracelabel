import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { KeyboardIcon, UndoIcon } from "@/components/ui/icons";
import { formatDuration } from "@/lib/format";
import { deriveTraceStats } from "@/presentation/traceStats";
import { useController } from "@/state/NavContext";

function TraceStatsChips() {
  const { trace } = useController();
  const stats = useMemo(() => deriveTraceStats(trace.turns), [trace.turns]);
  if (trace.document) return null;

  const chips = [
    stats.durationMs !== null && stats.durationMs > 0
      ? `${formatDuration(stats.durationMs)}`
      : null,
    stats.agents.length > 0
      ? `${stats.agents.length} agent${stats.agents.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <div className="hidden shrink-0 items-center gap-1.5 min-[1180px]:flex">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-line bg-surface-inset/55 px-2 py-1 font-mono text-[9px] text-ink-faint"
        >
          {chip}
        </span>
      ))}
      {stats.errorCount > 0 && (
        <span className="rounded-full border border-fail/20 bg-fail/10 px-2 py-1 font-mono text-[9px] font-medium text-fail">
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
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/88 px-4 text-sm text-ink shadow-sm shadow-black/20 backdrop-blur-xl">
      <nav className="flex min-w-0 shrink items-center gap-2">
        <Link
          to="/"
          className="shrink-0 rounded-md font-semibold tracking-tight text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          tracelabel
        </Link>
        <span className="text-line-strong">/</span>
        <Link
          to={`/p/${project}`}
          className="max-w-32 truncate rounded-sm text-xs text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {project}
        </Link>
        <span className="text-line-strong">/</span>
        <span className="max-w-44 truncate font-mono text-xs font-medium text-ink">
          {session.task}
        </span>
      </nav>

      <span className="rounded-full border border-line-strong bg-surface-raised px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-muted">
        {session.level}
      </span>
      <TraceStatsChips />

      <div className="ml-auto flex min-w-36 max-w-md flex-1 items-center gap-2.5">
        <div
          role="progressbar"
          aria-label="Labeling progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-inset ring-1 ring-inset ring-line"
        >
          <div
            className="h-full rounded-full bg-accent shadow-[0_0_12px_rgb(var(--accent-glow)/0.35)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] font-medium tabular-nums text-ink-muted">
          {done}/{total}
        </span>
      </div>

      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack}
        aria-label="↩ Prev"
        title="Back to previous target (u)"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-xs font-medium text-ink-muted outline-none transition-colors hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <UndoIcon className="h-4 w-4" />
        <span className="hidden min-[1100px]:inline">Previous</span>
      </button>
      <button
        type="button"
        onClick={() => setCheatOpen(true)}
        className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted outline-none transition-colors hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
      >
        <KeyboardIcon className="h-4 w-4" />
      </button>
    </header>
  );
}
