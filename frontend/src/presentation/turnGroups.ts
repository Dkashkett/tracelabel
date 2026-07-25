import type { ToolCall, Turn } from "@/api/types";

export interface PresentedToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface ToolInteraction {
  call: PresentedToolCall;
  result: Turn | null;
  // Derived from the paired result turn (never the call turn): a tool interaction's
  // duration and outcome are only known once its result has arrived.
  durationMs: number | null;
  status: "ok" | "error" | null;
  statusMessage: string | null;
}

// A single step in an assistant turn's activity cascade: a tool call(+result) or a
// non-handoff event (retrieval/agent/guardrail/span), interleaved in trace idx order.
export type ActivityItem =
  | { kind: "tool"; interaction: ToolInteraction }
  | { kind: "event"; turn: Turn };

export interface TurnGroup {
  turn: Turn;
  toolInteractions: ToolInteraction[];
  activity: ActivityItem[];
}

function presentToolCall(call: ToolCall): PresentedToolCall {
  return {
    id: call.id,
    name: call.name ?? call.function?.name ?? "tool",
    arguments: call.arguments ?? call.function?.arguments ?? "",
  };
}

function toolInteractionsForTurn(turn: Turn): ToolInteraction[] {
  return turn.role === "assistant"
    ? (turn.tool_calls ?? []).map((call) => ({
        call: presentToolCall(call),
        result: null,
        durationMs: null,
        status: null,
        statusMessage: null,
      }))
    : [];
}

function attachResult(interaction: ToolInteraction, result: Turn): void {
  interaction.result = result;
  interaction.durationMs = result.duration_ms ?? null;
  interaction.status = result.status ?? null;
  interaction.statusMessage = result.status_message ?? null;
}

// A tool interaction with no result yet sorts as if it happened at its owning assistant
// turn's idx, i.e. before any event that has arrived since (events always carry a real idx).
function activityIdx(item: ActivityItem, assistantIdx: number): number {
  return item.kind === "tool" ? (item.interaction.result?.idx ?? assistantIdx) : item.turn.idx;
}

function buildActivity(group: TurnGroup, events: Turn[]): void {
  const items: ActivityItem[] = [
    ...group.toolInteractions.map((interaction): ActivityItem => ({ kind: "tool", interaction })),
    ...events.map((turn): ActivityItem => ({ kind: "event", turn })),
  ];
  items.sort((a, b) => activityIdx(a, group.turn.idx) - activityIdx(b, group.turn.idx));
  group.activity = items;
}

/**
 * Builds a display-only hierarchy without changing the API turns. A tool result is consumed by
 * the earliest preceding, still-unmatched call with the same id. A non-handoff event turn
 * (retrieval/agent/guardrail/span) is folded into the activity cascade of the most recent
 * assistant turn; with no preceding assistant turn it stays a standalone top-level group so
 * nothing is lost. Handoff events and everything else stay top-level groups, and results that
 * cannot be paired stay in the top-level sequence so malformed and partial traces never lose
 * content.
 */
export function groupToolInteractions(turns: Turn[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const pendingById = new Map<string, ToolInteraction[]>();
  const eventsByGroup = new Map<TurnGroup, Turn[]>();
  let lastAssistantGroup: TurnGroup | null = null;

  const isCascadableEvent = (turn: Turn) => turn.role === "event" && turn.kind !== "handoff";

  for (const turn of turns) {
    if (turn.role === "tool" && turn.tool_call_id) {
      const pending = pendingById.get(turn.tool_call_id);
      const interaction = pending?.shift();
      if (interaction) {
        attachResult(interaction, turn);
        if (pending?.length === 0) pendingById.delete(turn.tool_call_id);
        continue;
      }
    }

    if (isCascadableEvent(turn) && lastAssistantGroup) {
      const events = eventsByGroup.get(lastAssistantGroup) ?? [];
      events.push(turn);
      eventsByGroup.set(lastAssistantGroup, events);
      continue;
    }

    const toolInteractions = toolInteractionsForTurn(turn);
    const group: TurnGroup = { turn, toolInteractions, activity: [] };
    groups.push(group);
    if (turn.role === "assistant") lastAssistantGroup = group;

    for (const interaction of toolInteractions) {
      if (!interaction.call.id) continue;
      const pending = pendingById.get(interaction.call.id) ?? [];
      pending.push(interaction);
      pendingById.set(interaction.call.id, pending);
    }
  }

  for (const group of groups) buildActivity(group, eventsByGroup.get(group) ?? []);

  return groups;
}

function isSilentGroup(group: TurnGroup): boolean {
  return (
    group.turn.role === "assistant" &&
    group.turn.content.trim() === "" &&
    group.activity.length > 0 &&
    !group.turn.labelable &&
    group.turn.status !== "error"
  );
}

/**
 * Folds a content-less, non-labelable assistant turn (tool_calls only, no reply text) into
 * the activity of the next assistant turn from the same agent — the reply that actually
 * answers. This keeps a tool-calling "thinking" turn from rendering as its own empty bubble
 * ahead of the real response. A turn stays visible on its own if it is labelable (a labeling
 * target must never disappear), errored, or if the trace ends or changes speaker/agent before
 * a reply arrives.
 */
export function mergeSilentActivity(groups: TurnGroup[]): TurnGroup[] {
  const result: TurnGroup[] = [];
  let pending: TurnGroup[] = [];

  const flushPending = () => {
    result.push(...pending);
    pending = [];
  };

  for (const group of groups) {
    const sameAgentAsPending =
      pending.length > 0 &&
      group.turn.role === "assistant" &&
      group.turn.agent === pending[pending.length - 1].turn.agent;

    if (sameAgentAsPending && isSilentGroup(group)) {
      // Another silent turn from the same agent: keep accumulating until a reply arrives.
      pending.push(group);
      continue;
    }

    if (sameAgentAsPending) {
      // The reply that answers the accumulated silent turns: fold their activity in.
      const mergedActivity = pending.flatMap((g) => g.activity).concat(group.activity);
      const mergedToolInteractions = pending
        .flatMap((g) => g.toolInteractions)
        .concat(group.toolInteractions);
      pending = [];
      result.push({
        turn: group.turn,
        toolInteractions: mergedToolInteractions,
        activity: mergedActivity,
      });
      continue;
    }

    flushPending();

    if (isSilentGroup(group)) {
      pending.push(group);
    } else {
      result.push(group);
    }
  }

  flushPending();

  return result;
}
