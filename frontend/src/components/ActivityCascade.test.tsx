import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "@/api/types";
import type { ActivityItem, ToolInteraction } from "@/presentation/turnGroups";
import { ActivityCascade } from "./ActivityCascade";

function toolItem(overrides: Partial<ToolInteraction> = {}): ActivityItem {
  return {
    kind: "tool",
    interaction: {
      call: { id: "call_1", name: "search", arguments: '{"q":"x"}' },
      result: null,
      durationMs: null,
      status: null,
      statusMessage: null,
      ...overrides,
    },
  };
}

function eventItem(overrides: Partial<Turn> = {}): ActivityItem {
  return {
    kind: "event",
    turn: {
      id: "t#5",
      idx: 5,
      role: "event",
      content: "",
      content_type: "text",
      labelable: false,
      metadata: { top_k: 3 },
      kind: "retrieval",
      name: "vector_search",
      ...overrides,
    },
  };
}

describe("ActivityCascade", () => {
  it("renders nothing when there is no activity", () => {
    const { container } = render(
      <ActivityCascade activity={[]} activeTurnIdx={null} onSelectTurn={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows each step as its own collapsed row, with an error badge on a failed step", () => {
    const errorResult: Turn = {
      id: "t#2",
      idx: 2,
      role: "tool",
      content: "boom",
      content_type: "text",
      tool_call_id: "call_1",
      labelable: false,
      metadata: {},
      duration_ms: 500,
      status: "error",
    };
    const { container } = render(
      <ActivityCascade
        activity={[toolItem({ result: errorResult, durationMs: 500, status: "error" }), eventItem()]}
        activeTurnIdx={null}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(screen.getByText("search")).toBeTruthy();
    expect(screen.getByText("vector_search")).toBeTruthy();
    expect(screen.getByText("error")).toBeTruthy();
    // the full arguments/result panel is not rendered until the row expands
    expect(container.querySelector("[data-tool-arguments]")).toBeNull();
  });

  it("expands an individual step, independently of the others, to reveal detail", () => {
    render(
      <ActivityCascade
        activity={[toolItem(), eventItem()]}
        activeTurnIdx={null}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(screen.queryByText(/top_k/)).toBeNull();

    const eventStep = screen.getByText("vector_search").closest("section")!;
    fireEvent.click(eventStep.querySelector("button")!);
    expect(screen.getByText(/top_k/)).toBeTruthy();
  });

  it("auto-expands only the matching step when it becomes the active turn", () => {
    const resultA: Turn = {
      id: "t#2",
      idx: 2,
      role: "tool",
      content: "a",
      content_type: "text",
      tool_call_id: "call_1",
      labelable: true,
      metadata: {},
    };
    const { rerender, container } = render(
      <ActivityCascade
        activity={[toolItem({ result: resultA }), eventItem()]}
        activeTurnIdx={null}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-tool-arguments]")).toBeNull();

    rerender(
      <ActivityCascade
        activity={[toolItem({ result: resultA }), eventItem()]}
        activeTurnIdx={2}
        onSelectTurn={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-tool-arguments]")).toBeTruthy();
    expect(screen.queryByText(/top_k/)).toBeNull();
  });

  it("opens every step with arguments visible when the owning assistant turn itself is active", () => {
    const { rerender, container } = render(
      <ActivityCascade activity={[toolItem(), eventItem()]} activeTurnIdx={0} onSelectTurn={vi.fn()} />,
    );
    expect(container.querySelector("[data-tool-arguments]")).toBeNull();

    rerender(
      <ActivityCascade
        activity={[toolItem(), eventItem()]}
        activeTurnIdx={0}
        parentActive
        onSelectTurn={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-tool-arguments]")).toBeTruthy();
    expect(screen.getByText(/top_k/)).toBeTruthy();
  });

  it("expands and collapses every step together when forceExpandAll flips", () => {
    const { rerender, container } = render(
      <ActivityCascade
        activity={[toolItem(), eventItem()]}
        activeTurnIdx={null}
        onSelectTurn={vi.fn()}
        forceExpandAll={false}
      />,
    );
    expect(container.querySelector("[data-tool-arguments]")).toBeNull();

    rerender(
      <ActivityCascade
        activity={[toolItem(), eventItem()]}
        activeTurnIdx={null}
        onSelectTurn={vi.fn()}
        forceExpandAll
      />,
    );
    expect(container.querySelector("[data-tool-arguments]")).toBeTruthy();
    expect(screen.getByText(/top_k/)).toBeTruthy();
  });

  it("marks the tool step's underlying result turn focusable and calls onSelectTurn on focus", () => {
    const result: Turn = {
      id: "t#2",
      idx: 2,
      role: "tool",
      content: "a",
      content_type: "text",
      tool_call_id: "call_1",
      labelable: true,
      metadata: {},
    };
    const onSelectTurn = vi.fn();
    const { container } = render(
      <ActivityCascade
        activity={[toolItem({ result })]}
        activeTurnIdx={null}
        onSelectTurn={onSelectTurn}
        forceExpandAll
      />,
    );
    const step = container.querySelector('[data-tool-call="call_1"]')!;
    expect(step.getAttribute("data-turn-idx")).toBe("2");
    expect(step.getAttribute("data-labelable")).toBe("true");
    fireEvent.focus(step);
    expect(onSelectTurn).toHaveBeenCalledWith(2);
  });
});
