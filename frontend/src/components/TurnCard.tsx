import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { Turn } from "@/api/types";
import type { ActivityItem } from "@/presentation/turnGroups";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/ui/icons";
import { ActivityCascade } from "./ActivityCascade";
import { ContentByType } from "./renderers/ContentByType";

function Content({ turn }: { turn: Turn }) {
  return <ContentByType content={turn.content} contentType={turn.content_type} />;
}

function TurnMeta({ turn }: { turn: Turn }) {
  if (!turn.name && !turn.tool_call_id && !turn.agent && typeof turn.duration_ms !== "number" && turn.status !== "error") {
    return null;
  }
  return (
    <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-ink-faint">
      {turn.name && <span>{turn.name}</span>}
      {turn.tool_call_id && <span>↳ {turn.tool_call_id}</span>}
      {turn.agent && (
        <span className="rounded-full border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-accent-strong">
          {turn.agent}
        </span>
      )}
      {typeof turn.duration_ms === "number" && <span>{formatDuration(turn.duration_ms)}</span>}
      {turn.status === "error" && (
        <span className="rounded-full bg-fail/15 px-1.5 py-0.5 font-semibold uppercase text-fail">error</span>
      )}
    </div>
  );
}

function SystemChip({ turn, active, onSelect }: { turn: Turn; active: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      data-turn-id={turn.id}
      data-turn-idx={turn.idx}
      data-turn-role={turn.role}
      data-active={active ? "true" : "false"}
      data-labelable={turn.labelable ? "true" : "false"}
      tabIndex={turn.labelable ? 0 : undefined}
      onFocus={(event) => {
        if (turn.labelable && event.target === event.currentTarget) onSelect();
      }}
      onClick={onSelect}
      className={cn(
        "mx-auto max-w-2xl rounded-xl border border-line-strong/70 bg-surface-inset/65 px-3.5 py-2.5 font-mono text-[10px] text-ink-faint",
        active && "border-accent/55 shadow-glow ring-1 ring-inset ring-accent/55",
        turn.labelable && "cursor-pointer",
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
        className="flex w-full items-center gap-2 text-left font-medium uppercase tracking-[0.14em]"
      >
        {expanded ? (
          <ChevronDownIcon className="h-3.5 w-3.5" />
        ) : (
          <ChevronRightIcon className="h-3.5 w-3.5" />
        )}
        System prompt
      </button>
      {expanded && (
        <div className="mt-2 text-sm text-ink-muted">
          <Content turn={turn} />
        </div>
      )}
    </div>
  );
}

export function TurnCard({
  turn,
  active,
  dimmed,
  onSelect,
  activity = [],
  activeTurnIdx = null,
  onSelectTurn,
  forceExpandAll,
  onSizeChange,
}: {
  turn: Turn;
  active: boolean;
  dimmed: boolean;
  onSelect: () => void;
  activity?: ActivityItem[];
  activeTurnIdx?: number | null;
  onSelectTurn?: (idx: number) => void;
  onSizeChange?: () => void;
  // Flips (any change in identity/value) toggles every activity cascade on this turn
  // open or closed together — driven by the `x` keyboard shortcut.
  forceExpandAll?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasContent = turn.content.length > 0;

  // A 400-line message must not push the next turn off screen: clamp to 40vh.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [turn.content, expanded]);

  if (turn.role === "system") {
    return <SystemChip turn={turn} active={active} onSelect={onSelect} />;
  }

  const isUser = turn.role === "user";
  const isAssistant = turn.role === "assistant";
  const bubbled = isUser || isAssistant;

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        data-turn-id={turn.id}
        data-turn-idx={turn.idx}
        data-turn-role={turn.role}
        data-active={active ? "true" : "false"}
        data-labelable={turn.labelable ? "true" : "false"}
        tabIndex={turn.labelable ? 0 : undefined}
        onFocus={(event) => {
          if (turn.labelable && event.target === event.currentTarget) onSelect();
        }}
        onClick={onSelect}
        className={cn(
          "min-w-0 rounded-2xl px-4 py-3.5 shadow-card transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
          bubbled ? "max-w-[78%]" : "w-full max-w-none",
          isUser && "rounded-tr-sm border border-line-strong bg-surface-raised",
          isAssistant && "rounded-tl-sm border border-accent/20 bg-accent/[0.055]",
          !bubbled && "border border-line-strong/70 bg-surface-inset/65",
          active && "border-accent/60 shadow-glow ring-1 ring-inset ring-accent/60",
          dimmed && !active && "border-line/80 shadow-none",
          turn.labelable && "cursor-pointer",
        )}
      >
        <div
          className={cn(
            "mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]",
            isAssistant ? "text-accent-strong" : "text-ink-faint",
          )}
        >
          {turn.role}
        </div>
        <TurnMeta turn={turn} />

        {hasContent && (
          <div
            ref={bodyRef}
            data-turn-content="true"
            className="overflow-hidden text-sm text-ink"
            style={{ maxHeight: expanded ? "none" : "40vh" }}
          >
            <Content turn={turn} />
          </div>
        )}

        {(clamped || expanded) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((value) => !value);
              onSizeChange?.();
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline"
          >
            {expanded ? "Collapse" : "Expand"}
            <ChevronDownIcon className={cn("h-3 w-3", expanded && "rotate-180")} />
          </button>
        )}

        {isAssistant && activity.length > 0 && (
          <ActivityCascade
            activity={activity}
            activeTurnIdx={activeTurnIdx}
            parentActive={active}
            forceExpandAll={forceExpandAll}
            onSelectTurn={(idx) => onSelectTurn?.(idx)}
            onSizeChange={onSizeChange}
          />
        )}
      </div>
    </div>
  );
}
