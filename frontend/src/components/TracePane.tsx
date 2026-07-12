import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useController } from "@/state/NavContext";
import { groupToolInteractions, rawTurnGroups } from "@/presentation/turnGroups";
import { DocumentPane } from "./DocumentPane";
import { TurnCard } from "./TurnCard";

const ESTIMATED_TURN_HEIGHT = 120;

export function TracePane() {
  const { trace, session, state, focusTurnByIdx } = useController();
  const turns = trace.turns;
  const parentRef = useRef<HTMLDivElement>(null);
  const turnLevel = session.level === "turn";
  const groups = useMemo(
    () => (turnLevel ? rawTurnGroups(turns) : groupToolInteractions(turns)),
    [turnLevel, turns],
  );

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: 8,
  });

  const activeArrayIdx = groups.findIndex(
    ({ turn, toolInteractions }) =>
      turn.idx === state.turnIdx ||
      toolInteractions.some((interaction) => interaction.result?.idx === state.turnIdx),
  );

  // Teleprompter scroll: anchor the active turn ~1/3 from the top on advance (06 §3).
  useEffect(() => {
    if (!turnLevel || activeArrayIdx < 0) return;
    virtualizer.scrollToIndex(activeArrayIdx, { align: "start" });
    const el = parentRef.current;
    if (el) {
      const activeTurnIdx = groups[activeArrayIdx]?.turn.idx;
      requestAnimationFrame(() => {
        el.querySelector<HTMLElement>(`[data-turn-idx="${activeTurnIdx}"]`)?.focus({
          preventScroll: true,
        });
        el.scrollBy?.({ top: -el.clientHeight / 3, behavior: "smooth" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArrayIdx, trace.trace.id, turnLevel]);

  const virtualItems = virtualizer.getVirtualItems();
  // A no-layout environment can report an empty range. Keep the fallback bounded so the app
  // never mounts an entire long trace while the real viewport measurement settles.
  const items =
    virtualItems.length > 0
      ? virtualItems
      : groups.slice(0, 16).map((_, index) => ({
          index,
          start: index * ESTIMATED_TURN_HEIGHT,
        }));
  const totalSize = Math.max(
    virtualizer.getTotalSize(),
    items.length * ESTIMATED_TURN_HEIGHT,
  );

  if (trace.document) {
    return <DocumentPane doc={trace.document} />;
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto bg-slate-50 dark:bg-slate-950">
      <div style={{ height: totalSize, position: "relative" }}>
        {items.map((vi) => {
          const group = groups[vi.index];
          const turn = group.turn;
          const active =
            turnLevel &&
            (turn.idx === state.turnIdx ||
              group.toolInteractions.some(
                (interaction) => interaction.result?.idx === state.turnIdx,
              ));
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
              key={turn.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
              className="border-b border-slate-200 dark:border-slate-800"
            >
              <TurnCard
                turn={turn}
                active={active}
                dimmed={dimmed}
                onSelect={() => turn.labelable && focusTurnByIdx(turn.idx)}
                toolInteractions={group.toolInteractions}
                showToolResults={!turnLevel}
                onSizeChange={remeasure}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
