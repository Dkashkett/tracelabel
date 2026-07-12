import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Turn } from "@/api/types";
import type { ToolInteraction } from "@/presentation/turnGroups";
import { ToolActivity } from "./ToolActivity";
import { ContentByType } from "./renderers/ContentByType";

const roleBorder: Record<Turn["role"], string> = {
  user: "border-l-blue-500",
  assistant: "border-l-green-500",
  tool: "border-l-amber-500",
  system: "border-l-slate-400",
};

function Content({ turn }: { turn: Turn }) {
  return <ContentByType content={turn.content} contentType={turn.content_type} />;
}

export function TurnCard({
  turn,
  active,
  dimmed,
  onSelect,
  toolInteractions = [],
  showToolResults = true,
  onSizeChange,
}: {
  turn: Turn;
  active: boolean;
  dimmed: boolean;
  onSelect: () => void;
  toolInteractions?: ToolInteraction[];
  showToolResults?: boolean;
  onSizeChange?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasContent = turn.content.length > 0;

  // A 400-line tool output must not push the next turn off screen (06 §4): clamp to 40vh.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [turn.content, expanded]);

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
        "border-l-4 bg-white px-4 py-3 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:bg-slate-900",
        roleBorder[turn.role],
        active && "ring-2 ring-sky-500",
        dimmed && "opacity-40",
        turn.labelable && "cursor-pointer",
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>{turn.role}</span>
        {turn.name && <span className="normal-case text-slate-500">{turn.name}</span>}
        {turn.tool_call_id && (
          <span className="normal-case text-slate-400">↳ {turn.tool_call_id}</span>
        )}
      </div>

      {hasContent && (
        <div
          ref={bodyRef}
          data-turn-content="true"
          className="overflow-hidden"
          style={{ maxHeight: expanded ? "none" : "40vh" }}
        >
          <Content turn={turn} />
        </div>
      )}

      {toolInteractions.length > 0 && (
        <ToolActivity
          interactions={toolInteractions}
          showResults={showToolResults}
          autoExpand={!showToolResults && active}
          onExpandedChange={onSizeChange}
        />
      )}

      {clamped && !expanded && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
            onSizeChange?.();
          }}
          className="mt-1 text-xs font-medium text-sky-600 hover:underline"
        >
          expand ▾
        </button>
      )}
      {expanded && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
            onSizeChange?.();
          }}
          className="mt-1 text-xs font-medium text-sky-600 hover:underline"
        >
          collapse ▴
        </button>
      )}
    </div>
  );
}
