import type { Turn } from "@/api/types";
import { ArrowRightIcon } from "@/components/ui/icons";

export function handoffLabel(turn: Turn): string {
  const metadata = turn.metadata as { from?: string; to?: string } | undefined;
  if (metadata?.from && metadata?.to) return `${metadata.from} → ${metadata.to}`;
  return turn.name || "Handoff";
}

export function HandoffDivider({ turn }: { turn: Turn }) {
  return (
    <div
      data-turn-id={turn.id}
      data-turn-idx={turn.idx}
      data-turn-role="event"
      data-event-kind="handoff"
      className="flex items-center gap-3 px-4 py-3"
    >
      <div className="h-px flex-1 bg-line" />
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface-raised px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        <ArrowRightIcon className="h-3 w-3 text-accent-strong" />
        {handoffLabel(turn)}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
