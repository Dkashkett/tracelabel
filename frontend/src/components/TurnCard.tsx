import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Turn } from "@/api/types";
import { ToolCallCard } from "./ToolCallCard";
import { HtmlFrame } from "./renderers/HtmlFrame";
import { JsonTree } from "./renderers/JsonTree";
import { PartsContent } from "./renderers/PartsContent";
import { TextContent } from "./renderers/TextContent";

const roleBorder: Record<Turn["role"], string> = {
  user: "border-l-blue-500",
  assistant: "border-l-green-500",
  tool: "border-l-amber-500",
  system: "border-l-slate-400",
  document: "border-l-purple-500",
};

function Content({ turn }: { turn: Turn }) {
  switch (turn.content_type) {
    case "text":
      return <TextContent content={turn.content} />;
    case "json":
      return <JsonTree content={turn.content} />;
    case "html":
      return <HtmlFrame content={turn.content} />;
    case "parts":
      return <PartsContent content={turn.content} />;
  }
}

export function TurnCard({
  turn,
  active,
  dimmed,
  onSelect,
}: {
  turn: Turn;
  active: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A 400-line tool output must not push the next turn off screen (06 §4): clamp to 40vh.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [turn.content, expanded]);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "border-l-4 bg-white px-4 py-3 transition-opacity dark:bg-slate-900",
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

      <div
        ref={bodyRef}
        className="overflow-hidden"
        style={{ maxHeight: expanded ? "none" : "40vh" }}
      >
        <Content turn={turn} />
        {turn.tool_calls?.map((call, i) => <ToolCallCard key={call.id ?? i} call={call} />)}
      </div>

      {clamped && !expanded && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
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
          }}
          className="mt-1 text-xs font-medium text-sky-600 hover:underline"
        >
          collapse ▴
        </button>
      )}
    </div>
  );
}
