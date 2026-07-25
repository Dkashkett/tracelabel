import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration, previewArguments } from "@/lib/format";
import type { ActivityItem, ToolInteraction } from "@/presentation/turnGroups";
import type { Turn } from "@/api/types";
import { KIND_ICON } from "./EventCard";
import { ContentByType } from "./renderers/ContentByType";
import { JsonTree } from "./renderers/JsonTree";

function activityTurnIdx(item: ActivityItem): number | null {
  return item.kind === "tool" ? (item.interaction.result?.idx ?? null) : item.turn.idx;
}

function isActiveItem(item: ActivityItem, activeTurnIdx: number | null): boolean {
  return activeTurnIdx !== null && activityTurnIdx(item) === activeTurnIdx;
}

function activityKey(item: ActivityItem, index: number): string {
  return item.kind === "tool" ? (item.interaction.call.id ?? `tool-${index}`) : item.turn.id;
}

function ToolStep({
  interaction,
  expanded,
  active,
  onToggle,
  onSelect,
}: {
  interaction: ToolInteraction;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const { call, result, durationMs, status, statusMessage } = interaction;
  const labelable = Boolean(result?.labelable);

  return (
    <section
      data-tool-call={call.id ?? call.name}
      data-turn-id={result?.id}
      data-turn-idx={result?.idx}
      data-turn-role="tool"
      data-labelable={labelable ? "true" : "false"}
      data-active={active ? "true" : "false"}
      tabIndex={labelable ? 0 : undefined}
      onFocus={(event) => {
        if (labelable && result && event.target === event.currentTarget) onSelect();
      }}
      onClick={() => labelable && result && onSelect()}
      className={cn(
        "rounded-lg border border-line bg-surface-inset/60",
        active && "ring-2 ring-inset ring-accent/70",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          if (labelable && result) onSelect();
          onToggle();
        }}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-raised"
      >
        <span aria-hidden="true" className="mt-px shrink-0 text-ink-faint">
          🔧
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-ink-muted">{call.name}</span>
          {!expanded && (
            <span className="ml-2 font-mono text-ink-faint">{previewArguments(call.arguments)}</span>
          )}
        </span>
        {typeof durationMs === "number" && (
          <span className="shrink-0 text-ink-faint">{formatDuration(durationMs)}</span>
        )}
        {status === "error" && (
          <span className="shrink-0 rounded-full bg-fail/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fail">
            error
          </span>
        )}
        <span aria-hidden="true" className="shrink-0 text-ink-faint">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-line px-2.5 py-2 text-xs">
          {statusMessage && <div className="mb-2 text-fail">{statusMessage}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                arguments
              </div>
              <div data-tool-arguments className="font-mono leading-relaxed text-ink">
                <ContentByType content={call.arguments} contentType="text" />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                result
              </div>
              {result ? (
                <div className="font-mono leading-relaxed text-ink">
                  <ContentByType content={result.content} contentType={result.content_type} />
                </div>
              ) : (
                <div className="text-ink-faint">No matching result in this trace.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function EventStep({
  turn,
  expanded,
  active,
  onToggle,
  onSelect,
}: {
  turn: Turn;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const metadata = (turn.metadata ?? {}) as Record<string, unknown>;
  const hasDetail = Object.keys(metadata).length > 0;
  const kind = turn.kind ?? "span";

  return (
    <section
      data-turn-id={turn.id}
      data-turn-idx={turn.idx}
      data-turn-role="event"
      data-event-kind={kind}
      data-labelable={turn.labelable ? "true" : "false"}
      data-active={active ? "true" : "false"}
      tabIndex={turn.labelable ? 0 : undefined}
      onFocus={(event) => {
        if (turn.labelable && event.target === event.currentTarget) onSelect();
      }}
      onClick={() => turn.labelable && onSelect()}
      className={cn(
        "rounded-lg border border-line bg-surface-inset/60 px-2.5 py-1.5 text-xs text-ink-muted",
        active && "ring-2 ring-inset ring-accent/70",
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
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
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
    </section>
  );
}

export function ActivityCascade({
  activity,
  activeTurnIdx,
  parentActive,
  forceExpandAll,
  onSelectTurn,
  onSizeChange,
}: {
  activity: ActivityItem[];
  activeTurnIdx: number | null;
  // True when the assistant turn that owns this cascade is itself the active target — every
  // step opens with its arguments visible, same as focusing an individual nested step.
  parentActive?: boolean;
  // Every change of this value expands (true) or collapses (false) every cascade and its
  // steps together, driven by the global `x` keyboard shortcut.
  forceExpandAll?: boolean;
  onSelectTurn: (idx: number) => void;
  onSizeChange?: () => void;
}) {
  const [itemOpen, setItemOpen] = useState<boolean[]>(() =>
    activity.map(
      (item) => Boolean(parentActive) || isActiveItem(item, activeTurnIdx) || Boolean(forceExpandAll),
    ),
  );
  const previousTrigger = useRef(`${activeTurnIdx}:${Boolean(parentActive)}`);
  const previousForceExpandAll = useRef(forceExpandAll);

  // A step's arguments auto-expand when the assistant turn that owns the cascade (all steps
  // open) or the step itself (only that step opens) becomes the active target — so `j`/`k`
  // navigation and the teleprompter focus effect in TracePane always land on a visible,
  // focusable element with its detail in view.
  useEffect(() => {
    const trigger = `${activeTurnIdx}:${Boolean(parentActive)}`;
    if (previousTrigger.current === trigger) return;
    previousTrigger.current = trigger;
    const containsActive = Boolean(parentActive) || activity.some((item) => isActiveItem(item, activeTurnIdx));
    if (!containsActive) return;
    setItemOpen(activity.map((item) => Boolean(parentActive) || isActiveItem(item, activeTurnIdx)));
    onSizeChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTurnIdx, parentActive]);

  useEffect(() => {
    if (previousForceExpandAll.current === forceExpandAll) return;
    previousForceExpandAll.current = forceExpandAll;
    setItemOpen(activity.map(() => Boolean(forceExpandAll)));
    onSizeChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceExpandAll]);

  if (activity.length === 0) return null;

  const toggleItem = (index: number) => {
    setItemOpen((current) => current.map((value, i) => (i === index ? !value : value)));
    onSizeChange?.();
  };

  return (
    <div
      data-activity-cascade="true"
      onClick={(event) => event.stopPropagation()}
      className="mt-3 border-l-2 border-accent/20 border-t border-t-line/60 pl-3 pt-2"
    >
      <div data-tool-calls="true" className="space-y-1.5">
        {activity.map((item, index) =>
          item.kind === "tool" ? (
            <ToolStep
              key={activityKey(item, index)}
              interaction={item.interaction}
              expanded={itemOpen[index] ?? false}
              active={isActiveItem(item, activeTurnIdx)}
              onToggle={() => toggleItem(index)}
              onSelect={() => item.interaction.result && onSelectTurn(item.interaction.result.idx)}
            />
          ) : (
            <EventStep
              key={activityKey(item, index)}
              turn={item.turn}
              expanded={itemOpen[index] ?? false}
              active={isActiveItem(item, activeTurnIdx)}
              onToggle={() => toggleItem(index)}
              onSelect={() => onSelectTurn(item.turn.idx)}
            />
          ),
        )}
      </div>
    </div>
  );
}
