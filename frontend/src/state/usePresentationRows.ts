import { useMemo } from "react";
import { flattenPresentation, type PresentationRow } from "@/presentation/agentSections";
import { groupToolInteractions, mergeSilentActivity } from "@/presentation/turnGroups";
import { useController } from "./NavContext";

/**
 * The single source of truth for the flattened row list, rendered by TracePane. Both turn-level
 * and trace-level labeling use the same activity-cascade grouping for display — a labelable
 * tool/event turn nested in a cascade stays reachable by keyboard because keyboard order
 * (NavContext::labelableTurns) walks the raw trace turns, not these rows; TracePane auto-expands
 * a cascade when one of its nested steps becomes the active turn.
 */
export function usePresentationRows(): PresentationRow[] {
  const { trace } = useController();
  return useMemo(
    () => flattenPresentation(mergeSilentActivity(groupToolInteractions(trace.turns))),
    [trace.turns],
  );
}
