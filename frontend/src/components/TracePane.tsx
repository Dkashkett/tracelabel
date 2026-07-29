import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { useController } from "@/state/NavContext";
import { usePresentationRows } from "@/state/usePresentationRows";
import type { PresentationRow } from "@/presentation/agentSections";
import { AgentSectionHeader } from "./AgentSectionHeader";
import { DocumentPane } from "./DocumentPane";
import { EventCard } from "./EventCard";
import { HandoffDivider } from "./HandoffDivider";
import { TurnCard } from "./TurnCard";

const ESTIMATED_TURN_HEIGHT = 160;

export function TracePane() {
  const { trace, session, state, focusTurnByIdx, toolCallsExpanded } = useController();
  const parentRef = useRef<HTMLDivElement>(null);
  const turnLevel = session.level === "turn";
  const rows = usePresentationRows();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: 8,
  });

  const isActiveRow = (row: PresentationRow) =>
    row.kind === "turn" &&
    (row.turn.idx === state.turnIdx ||
      row.activity.some((item) =>
        item.kind === "tool"
          ? item.interaction.result?.idx === state.turnIdx
          : item.turn.idx === state.turnIdx,
      ));

  const activeArrayIdx = rows.findIndex(isActiveRow);

  // Teleprompter scroll: anchor the active turn ~1/3 from the top on advance (06 §3).
  useEffect(() => {
    if (!turnLevel || activeArrayIdx < 0) return;
    virtualizer.scrollToIndex(activeArrayIdx, { align: "start" });
    const el = parentRef.current;
    if (el) {
      const frame = requestAnimationFrame(() => {
        el.querySelector<HTMLElement>(`[data-turn-idx="${state.turnIdx}"]`)?.focus({
          preventScroll: true,
        });
        el.scrollBy?.({ top: -el.clientHeight / 3, behavior: "smooth" });
      });
      return () => cancelAnimationFrame(frame);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArrayIdx, trace.trace.id, turnLevel]);

  const virtualItems = virtualizer.getVirtualItems();
  // A no-layout environment can report an empty range. Keep the fallback bounded so the app
  // never mounts an entire long trace while the real viewport measurement settles.
  const items =
    virtualItems.length > 0
      ? virtualItems
      : rows.slice(0, 16).map((_, index) => ({
          index,
          start: index * ESTIMATED_TURN_HEIGHT,
        }));
  const totalSize = Math.max(virtualizer.getTotalSize(), items.length * ESTIMATED_TURN_HEIGHT);

  if (trace.document) {
    return <DocumentPane doc={trace.document} />;
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto bg-bg bg-[radial-gradient(circle_at_50%_0%,rgb(var(--accent)/0.035),transparent_32rem)]"
    >
      <div
        className="mx-auto max-w-[880px] px-7 py-3 min-[1200px]:px-10"
        style={{ height: totalSize, position: "relative" }}
      >
        {items.map((vi) => {
          const row = rows[vi.index];
          const active = isActiveRow(row);
          const dimmed = turnLevel && !state.peek && !active;
          const remeasure = () => {
            requestAnimationFrame(() => {
              const element = parentRef.current?.querySelector<HTMLElement>(
                `[data-index="${vi.index}"]`,
              );
              if (element) virtualizer.measureElement(element);
            });
          };
          return (
            <div
              key={row.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
              className={cn("py-2", row.kind !== "section-header" && row.indent && "pl-6")}
            >
              {row.kind === "section-header" && <AgentSectionHeader agent={row.agent} />}
              {row.kind === "handoff" && <HandoffDivider turn={row.turn} />}
              {row.kind === "event" && <EventCard turn={row.turn} dimmed={dimmed} />}
              {row.kind === "turn" && (
                <TurnCard
                  turn={row.turn}
                  active={active}
                  dimmed={dimmed}
                  onSelect={() => row.turn.labelable && focusTurnByIdx(row.turn.idx)}
                  activity={row.activity}
                  activeTurnIdx={state.turnIdx}
                  onSelectTurn={focusTurnByIdx}
                  forceExpandAll={toolCallsExpanded}
                  onSizeChange={remeasure}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
