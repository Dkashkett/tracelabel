import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useController } from "@/state/NavContext";
import { TurnCard } from "./TurnCard";

export function TracePane() {
  const { trace, session, state, focusTurnByIdx } = useController();
  const turns = trace.turns;
  const parentRef = useRef<HTMLDivElement>(null);
  const turnLevel = session.level === "turn";

  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  });

  const activeArrayIdx = turns.findIndex((t) => t.idx === state.turnIdx);

  // Teleprompter scroll: anchor the active turn ~1/3 from the top on advance (06 §3).
  useEffect(() => {
    if (!turnLevel || activeArrayIdx < 0) return;
    virtualizer.scrollToIndex(activeArrayIdx, { align: "start" });
    const el = parentRef.current;
    if (el) {
      requestAnimationFrame(() => el.scrollBy({ top: -el.clientHeight / 3, behavior: "smooth" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArrayIdx, trace.trace.id, turnLevel]);

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="h-full overflow-auto bg-slate-50 dark:bg-slate-950">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vi) => {
          const turn = turns[vi.index];
          const active = turnLevel && turn.idx === state.turnIdx;
          const dimmed = turnLevel && !state.peek && !active;
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
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
