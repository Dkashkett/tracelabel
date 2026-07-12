import { useEffect, useRef, useState } from "react";
import type { ToolInteraction } from "@/presentation/turnGroups";
import { ContentByType } from "./renderers/ContentByType";

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function activitySummary(interactions: ToolInteraction[], showResults: boolean) {
  const calls = countLabel(interactions.length, "tool call", "tool calls");
  const names = interactions.map(({ call }) => call.name).join(", ");
  if (!showResults) return `${calls} · ${names}`;

  const resultCount = interactions.filter(({ result }) => result !== null).length;
  const missingCount = interactions.length - resultCount;
  const parts = [calls, names, countLabel(resultCount, "result received", "results received")];
  if (missingCount > 0) {
    parts.push(countLabel(missingCount, "call without result", "calls without results"));
  }
  return parts.join(" · ");
}

export function ToolActivity({
  interactions,
  showResults,
  autoExpand = false,
  onExpandedChange,
}: {
  interactions: ToolInteraction[];
  showResults: boolean;
  autoExpand?: boolean;
  onExpandedChange?: () => void;
}) {
  const [open, setOpen] = useState(autoExpand);
  const previousAutoExpand = useRef(autoExpand);

  // In turn mode, moving the labeling target opens its call evidence and restores the previous
  // turn to its compact summary. Manual disclosure remains available after that transition.
  useEffect(() => {
    if (previousAutoExpand.current === autoExpand) return;
    previousAutoExpand.current = autoExpand;
    setOpen(autoExpand);
    onExpandedChange?.();
    // The callback only asks the parent virtual row to remeasure; changes to its identity must
    // not overwrite a user's manual disclosure state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand]);

  const summary = activitySummary(interactions, showResults);

  return (
    <div
      data-tool-activity="true"
      onClick={(event) => event.stopPropagation()}
      className="mt-2 border-t border-slate-200 pt-2 text-xs dark:border-slate-700"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
          onExpandedChange?.();
        }}
        className="flex w-full items-start gap-2 text-left text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <span aria-hidden="true" className="mt-px w-3 shrink-0 text-slate-400">
          {open ? "▾" : "▸"}
        </span>
        <span className="font-semibold text-slate-600 dark:text-slate-300">Tool activity</span>
        <span className="min-w-0 text-slate-400">{summary}</span>
      </button>

      {open && (
        <div className="ml-5 mt-2 space-y-3 border-l border-slate-200 pl-3 dark:border-slate-700">
          {interactions.map(({ call, result }, index) => (
            <section
              key={`${call.id ?? call.name}-${index}`}
              data-tool-call={call.id ?? call.name}
            >
              <div className="mb-1 flex flex-wrap items-baseline gap-2 font-semibold text-slate-600 dark:text-slate-300">
                <span>
                  Call {index + 1} · {call.name}
                </span>
                {call.id && <span className="font-normal text-slate-400">{call.id}</span>}
              </div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                arguments
              </div>
              <div data-tool-arguments className="font-mono text-slate-700 dark:text-slate-200">
                <ContentByType content={call.arguments} contentType="text" />
              </div>

              {showResults &&
                (result ? (
                  <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>result received</span>
                      {result.name && (
                        <span className="normal-case tracking-normal text-slate-500">
                          {result.name}
                        </span>
                      )}
                    </div>
                    <ContentByType content={result.content} contentType={result.content_type} />
                  </div>
                ) : (
                  <div className="mt-2 border-t border-slate-100 pt-2 text-slate-400 dark:border-slate-800">
                    No matching result in this trace.
                  </div>
                ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
