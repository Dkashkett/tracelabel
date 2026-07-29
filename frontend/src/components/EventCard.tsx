import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { Turn } from "@/api/types";
import { JsonTree } from "./renderers/JsonTree";
import {
  ActivityIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  ShieldIcon,
  type IconProps,
} from "@/components/ui/icons";

const KIND_ICON: Record<string, (props: IconProps) => JSX.Element> = {
  retrieval: SearchIcon,
  agent: BotIcon,
  guardrail: ShieldIcon,
  span: ActivityIcon,
};

export function EventKindIcon({ kind, className }: { kind: string; className?: string }) {
  const KindIcon = KIND_ICON[kind] ?? ActivityIcon;
  return <KindIcon className={className} />;
}

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
        "rounded-lg border border-line bg-surface-inset/45 px-3 py-2 text-xs text-ink-muted transition-all",
        dimmed && "border-line/70",
      )}
    >
      <div className="flex items-center gap-2">
        <EventKindIcon kind={kind} className="h-3.5 w-3.5 text-accent-strong" />
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
            {expanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5" />
            )}
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
