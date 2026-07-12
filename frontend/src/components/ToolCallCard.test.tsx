import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "@/api/types";
import { ToolCallCard } from "./ToolCallCard";

const result: Turn = {
  id: "trace#2",
  idx: 2,
  role: "tool",
  content: '{"answer":42}',
  content_type: "json",
  tool_call_id: "call_1",
  name: "lookup",
  labelable: false,
  metadata: {},
};

describe("ToolCallCard", () => {
  it("starts compact and expands to show raw arguments and the rendered result", () => {
    render(
      <ToolCallCard
        interaction={{
          call: { id: "call_1", name: "lookup", arguments: '{"id":42}' },
          result,
        }}
      />,
    );

    const button = screen.getByRole("button", { name: /lookup/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/"id":42/)).toBeNull();
    expect(screen.queryByText(/"answer"/)).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/"id":42/)).toBeTruthy();
    expect(screen.getByText(/answer:/)).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(button.closest("[data-tool-interaction]")?.className).toContain("ml-4");
  });

  it("reports disclosure changes so the virtual row can be remeasured", () => {
    const onExpandedChange = vi.fn();
    render(
      <ToolCallCard
        interaction={{ call: { name: "lookup", arguments: "{}" }, result: null }}
        onExpandedChange={onExpandedChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /lookup/ }));
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No matching result in this trace.")).toBeTruthy();
  });
});
