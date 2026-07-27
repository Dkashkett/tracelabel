// Read-only rendering of a single TraceDetail for the import preview step.
//
// TracePane (components/TracePane.tsx) composes these same pieces, but it's built
// against useController()/usePresentationRows() — an active labeling session with
// focus state, keyboard nav, and a virtualizer. A preview trace during import
// belongs to no task and no session, so none of that applies. This component reuses
// TracePane's actual rendering primitives (flattenPresentation + TurnCard/EventCard/
// ActivityCascade/DocumentPane) but skips the controller, virtualization, and
// scroll-to-active behavior entirely — every row just renders in a plain list,
// nothing is ever "active", and selection callbacks are no-ops since nothing is
// selectable in a preview.
import type { TraceDetail } from "@/api/types";
import { flattenPresentation, type PresentationRow } from "@/presentation/agentSections";
import { groupToolInteractions, mergeSilentActivity } from "@/presentation/turnGroups";
import { AgentSectionHeader } from "@/components/AgentSectionHeader";
import { DocumentPane } from "@/components/DocumentPane";
import { EventCard } from "@/components/EventCard";
import { HandoffDivider } from "@/components/HandoffDivider";
import { TurnCard } from "@/components/TurnCard";

const noop = () => {};

export function TracePreview({ trace }: { trace: TraceDetail }) {
  if (trace.document) {
    return (
      <div className="h-72 overflow-auto rounded-lg border border-line">
        <DocumentPane doc={trace.document} />
      </div>
    );
  }

  const rows: PresentationRow[] = flattenPresentation(
    mergeSilentActivity(groupToolInteractions(trace.turns)),
  );

  return (
    <div className="max-h-96 space-y-1.5 overflow-auto rounded-lg border border-line bg-bg px-4 py-3">
      {rows.map((row) => (
        <div key={row.key} className={row.kind !== "section-header" && row.indent ? "pl-6" : undefined}>
          {row.kind === "section-header" && <AgentSectionHeader agent={row.agent} />}
          {row.kind === "handoff" && <HandoffDivider turn={row.turn} />}
          {row.kind === "event" && <EventCard turn={row.turn} dimmed={false} />}
          {row.kind === "turn" && (
            <TurnCard
              turn={row.turn}
              active={false}
              dimmed={false}
              onSelect={noop}
              activity={row.activity}
              activeTurnIdx={null}
              onSelectTurn={noop}
              forceExpandAll={false}
            />
          )}
        </div>
      ))}
    </div>
  );
}
