import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "@/api/types";
import { ToolActivity } from "./ToolActivity";

const firstResult: Turn = {
  id: "trace#2",
  idx: 2,
  role: "tool",
  content: '{"answer":42}',
  content_type: "json",
  tool_call_id: "call_1",
  name: "search",
  labelable: false,
  metadata: {},
};

describe("ToolActivity", () => {
  it("summarizes many calls in one compact row and expands them in call order", () => {
    const { container } = render(
      <ToolActivity
        interactions={[
          {
            call: { id: "call_1", name: "search", arguments: '{"q":"x"}' },
            result: firstResult,
          },
          {
            call: { id: "call_2", name: "fetch", arguments: '{"url":"example.test"}' },
            result: null,
          },
        ]}
        showResults
      />,
    );

    const button = screen.getByRole("button", {
      name: /Tool activity.*2 tool calls.*search, fetch.*1 result received.*1 call without result/,
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/"q":"x"/)).toBeNull();
    expect(container.querySelectorAll("[data-tool-activity]")).toHaveLength(1);

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/"q":"x"/)).toBeTruthy();
    expect(screen.getByText(/"url":"example.test"/)).toBeTruthy();
    expect(screen.getByText(/answer:/)).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("No matching result in this trace.")).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll("[data-tool-call]")).map((node) =>
        node.getAttribute("data-tool-call"),
      ),
    ).toEqual(["call_1", "call_2"]);
  });

  it("shows call arguments automatically for an active turn without claiming a missing result", () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <ToolActivity
        interactions={[
          { call: { id: "call_1", name: "search", arguments: '{"q":"x"}' }, result: null },
        ]}
        showResults={false}
        autoExpand
        onExpandedChange={onExpandedChange}
      />,
    );

    expect(screen.getByRole("button", { name: /Tool activity.*1 tool call.*search/ })).toHaveProperty(
      "ariaExpanded",
      "true",
    );
    expect(screen.getByText(/"q":"x"/)).toBeTruthy();
    expect(screen.queryByText(/without result/)).toBeNull();
    expect(screen.queryByText("No matching result in this trace.")).toBeNull();

    rerender(
      <ToolActivity
        interactions={[
          { call: { id: "call_1", name: "search", arguments: '{"q":"x"}' }, result: null },
        ]}
        showResults={false}
        autoExpand={false}
        onExpandedChange={onExpandedChange}
      />,
    );

    expect(screen.getByRole("button", { name: /Tool activity/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByText(/"q":"x"/)).toBeNull();
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
  });
});
