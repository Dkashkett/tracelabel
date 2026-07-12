import type { ToolCall, Turn } from "@/api/types";

export interface PresentedToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface ToolInteraction {
  call: PresentedToolCall;
  result: Turn | null;
}

export interface TurnGroup {
  turn: Turn;
  toolInteractions: ToolInteraction[];
}

function presentToolCall(call: ToolCall): PresentedToolCall {
  return {
    id: call.id,
    name: call.name ?? call.function?.name ?? "tool",
    arguments: call.arguments ?? call.function?.arguments ?? "",
  };
}

/**
 * Builds a display-only hierarchy without changing the API turns. A tool result is consumed by
 * the earliest preceding, still-unmatched call with the same id. Results that cannot be paired
 * stay in the top-level sequence so malformed and partial traces never lose content.
 */
export function groupToolInteractions(turns: Turn[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const pendingById = new Map<string, ToolInteraction[]>();

  for (const turn of turns) {
    if (turn.role === "tool" && turn.tool_call_id) {
      const pending = pendingById.get(turn.tool_call_id);
      const interaction = pending?.shift();
      if (interaction) {
        interaction.result = turn;
        if (pending?.length === 0) pendingById.delete(turn.tool_call_id);
        continue;
      }
    }

    const toolInteractions: ToolInteraction[] =
      turn.role === "assistant"
        ? (turn.tool_calls ?? []).map((call) => ({ call: presentToolCall(call), result: null }))
        : [];
    groups.push({ turn, toolInteractions });

    for (const interaction of toolInteractions) {
      if (!interaction.call.id) continue;
      const pending = pendingById.get(interaction.call.id) ?? [];
      pending.push(interaction);
      pendingById.set(interaction.call.id, pending);
    }
  }

  return groups;
}
