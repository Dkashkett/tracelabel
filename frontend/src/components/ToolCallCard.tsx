import { useState } from "react";
import type { ToolInteraction } from "@/presentation/turnGroups";
import { ContentByType } from "./renderers/ContentByType";

export function ToolCallCard({
  interaction,
  onExpandedChange,
}: {
  interaction: ToolInteraction;
  onExpandedChange?: () => void;
}) {
  const { call, result } = interaction;
  const [open, setOpen] = useState(false);

  function toggle() {
    setOpen((current) => !current);
    onExpandedChange?.();
  }

  return (
    <div
      data-tool-interaction={call.id ?? call.name}
      onClick={(event) => event.stopPropagation()}
      className="ml-4 mt-2 rounded border border-amber-300 bg-amber-50 text-xs dark:border-amber-700/60 dark:bg-amber-900/20"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        className="flex w-full items-center gap-2 px-2 py-1 text-left font-medium text-amber-800 dark:text-amber-300"
      >
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        <span>⚙ {call.name}</span>
      </button>
      {open && (
        <div className="border-t border-amber-200 dark:border-amber-800">
          <div className="px-2 py-1.5">
            <div className="mb-1 font-semibold uppercase tracking-wide text-slate-400">
              arguments
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {call.arguments}
            </pre>
          </div>
          {result ? (
            <div className="border-t border-amber-200 px-2 py-1.5 dark:border-amber-800">
              <div className="mb-1 flex items-center gap-2 font-semibold uppercase tracking-wide text-slate-400">
                <span>result</span>
                {result.name && (
                  <span className="normal-case tracking-normal text-slate-500">{result.name}</span>
                )}
              </div>
              <ContentByType content={result.content} contentType={result.content_type} />
            </div>
          ) : (
            <div className="border-t border-amber-200 px-2 py-1.5 text-slate-400 dark:border-amber-800">
              No matching result in this trace.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
