import type { Turn } from "@/api/types";
import type { ActivityItem, TurnGroup } from "./turnGroups";

export type PresentationRow =
  | { kind: "section-header"; key: string; agent: string; indent: boolean }
  | { kind: "handoff"; key: string; turn: Turn; indent: boolean }
  | { kind: "event"; key: string; turn: Turn; indent: boolean }
  | {
      kind: "turn";
      key: string;
      turn: Turn;
      activity: ActivityItem[];
      indent: boolean;
    };

/**
 * Partitions turn groups into contiguous agent segments and flattens them into one
 * typed row list, so the trace pane's virtualizer stays a simple flat list (06 §4).
 *
 * The "primary" agent is the first *named* agent encountered (usually an
 * orchestrator/root agent, or the trace's only agent) — its rows are never
 * indented. Every other agent is treated as a sub-agent segment and gets a
 * lightweight agent marker plus a subtle left inset on its rows (indent, not
 * nesting). A trace with no `agent` field anywhere (the common case) produces no
 * markers and no indentation at all.
 */
export function flattenPresentation(groups: TurnGroup[]): PresentationRow[] {
  const rows: PresentationRow[] = [];
  let currentAgent: string | undefined;
  let primaryAgent: string | undefined;

  for (const group of groups) {
    const { turn } = group;
    const agent = turn.agent ?? undefined;

    if (agent !== currentAgent) {
      currentAgent = agent;
      if (agent && primaryAgent === undefined) primaryAgent = agent;
      if (agent) {
        rows.push({
          kind: "section-header",
          key: `section-${turn.id}`,
          agent,
          indent: agent !== primaryAgent,
        });
      }
    }

    const indent = Boolean(currentAgent) && currentAgent !== primaryAgent;

    if (turn.role === "event" && turn.kind === "handoff") {
      rows.push({ kind: "handoff", key: turn.id, turn, indent });
    } else if (turn.role === "event") {
      rows.push({ kind: "event", key: turn.id, turn, indent });
    } else {
      rows.push({
        kind: "turn",
        key: turn.id,
        turn,
        activity: group.activity,
        indent,
      });
    }
  }

  return rows;
}
