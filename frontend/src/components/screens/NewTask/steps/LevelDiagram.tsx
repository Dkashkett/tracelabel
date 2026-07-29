import { cn } from "@/lib/utils";

const EXAMPLE_TURNS = [
  { role: "user" as const, text: "Where's my order?" },
  { role: "assistant" as const, text: "Let me check that for you." },
  { role: "user" as const, text: "It's been two weeks." },
  { role: "assistant" as const, text: "I've issued a refund." },
];

export interface LevelDiagramProps {
  level: "trace" | "turn";
  selected: boolean;
}

function labelPillClasses(selected: boolean) {
  return cn(
    "shrink-0 self-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-medium",
    selected
      ? "border-accent/40 bg-accent/10 text-accent-strong"
      : "border-line-strong bg-surface-inset text-ink-faint",
  );
}

// A tiny replica of a real conversation (TurnCard.tsx's bubble styling, scaled down)
// with example text, so what "one label per trace" vs "one label per turn" actually
// covers reads at a glance instead of as an abstract diagram.
export function LevelDiagram({ level, selected }: LevelDiagramProps) {
  const bubbleBorder = selected ? "border-accent/30" : "border-line";

  return (
    <div className="flex items-stretch gap-2">
      <div className="flex flex-1 flex-col gap-1.5">
        {EXAMPLE_TURNS.map((turn, i) => {
          const isUser = turn.role === "user";
          return (
            <div key={i} className={cn("flex items-center gap-1.5", isUser ? "justify-end" : "justify-start")}>
              {!isUser && level === "turn" && <span className={labelPillClasses(selected)}>label</span>}
              <span
                className={cn(
                  "max-w-[75%] truncate rounded-lg border px-2 py-1 text-[10px] leading-snug",
                  bubbleBorder,
                  isUser ? "bg-accent/10 text-ink" : "bg-surface-raised text-ink",
                )}
              >
                {turn.text}
              </span>
              {isUser && level === "turn" && <span className={labelPillClasses(selected)}>label</span>}
            </div>
          );
        })}
      </div>

      {level === "trace" && (
        <div className="flex items-center gap-1.5">
          <span className={cn("w-px self-stretch", selected ? "bg-accent/40" : "bg-line-strong")} aria-hidden />
          <span className={labelPillClasses(selected)}>1 label</span>
        </div>
      )}
    </div>
  );
}
