import type { Turn } from "@/api/types";

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
      className="flex items-center gap-3 px-4 py-2"
    >
      <div className="h-px flex-1 bg-line" />
      <span className="shrink-0 rounded-full border border-line bg-surface-raised px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {handoffLabel(turn)}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
