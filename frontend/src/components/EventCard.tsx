import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { Turn } from "@/api/types";
import { JsonTree } from "./renderers/JsonTree";

export const KIND_ICON: Record<string, string> = {
  retrieval: "🔎",
  agent: "🤖",
  guardrail: "🛡️",
  span: "⚙️",
};

export function EventCard({ turn, dimmed }: { turn: Turn; dimmed: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const metadata = (turn.metadata ?? {}) as Record<string, unknown>;
  const hasDetail = Object.keys(metadata).length > 0;
  const kind = turn.kind ?? "span";

  return (
    <div
      data-turn-id={turn.id}
      data-turn-idx={turn.idx}
      data-turn-role="event"
      data-event-kind={kind}
      className={cn(
        "border-l-2 border-l-accent/30 bg-surface-inset/40 px-4 py-1.5 text-xs text-ink-muted transition-opacity",
        dimmed && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{KIND_ICON[kind] ?? KIND_ICON.span}</span>
        <span className="font-medium">{turn.name || kind}</span>
        {typeof turn.duration_ms === "number" && (
          <span className="text-ink-faint">{formatDuration(turn.duration_ms)}</span>
        )}
        {turn.status === "error" && (
          <span className="rounded-full bg-fail/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fail">
            error
          </span>
        )}
        {hasDetail && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="ml-auto shrink-0 text-ink-faint hover:text-ink"
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {turn.status === "error" && turn.status_message && (
        <div className="mt-1 text-fail">{turn.status_message}</div>
      )}
      {expanded && hasDetail && (
        <div className="mt-1">
          <JsonTree content={JSON.stringify(metadata)} />
        </div>
      )}
    </div>
  );
}
