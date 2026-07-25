import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "@/api/types";
import { TurnCard } from "./TurnCard";

function baseTurn(overrides: Partial<Turn> & Pick<Turn, "id" | "idx" | "role">): Turn {
  return {
    content: "hello",
    content_type: "text",
    labelable: false,
    metadata: {},
    ...overrides,
  };
}

describe("TurnCard", () => {
  it("right-justifies a user turn and left-justifies an assistant turn", () => {
    const { container: userContainer } = render(
      <TurnCard turn={baseTurn({ id: "t#0", idx: 0, role: "user" })} active={false} dimmed={false} onSelect={vi.fn()} />,
    );
    expect(userContainer.querySelector(".justify-end")).toBeTruthy();

    const { container: assistantContainer } = render(
      <TurnCard turn={baseTurn({ id: "t#1", idx: 1, role: "assistant" })} active={false} dimmed={false} onSelect={vi.fn()} />,
    );
    expect(assistantContainer.querySelector(".justify-start")).toBeTruthy();
  });

  it("renders a system turn as a collapsed chip that expands its content on click", () => {
    const turn = baseTurn({ id: "t#0", idx: 0, role: "system", content: "You are a helpful assistant." });
    render(<TurnCard turn={turn} active={false} dimmed={false} onSelect={vi.fn()} />);
    expect(screen.getByText("System prompt")).toBeTruthy();
    expect(screen.queryByText("You are a helpful assistant.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /system prompt/i }));
    expect(screen.getByText("You are a helpful assistant.")).toBeTruthy();
  });

  it("shows an agent chip and a duration chip when present", () => {
    const turn = baseTurn({ id: "t#0", idx: 0, role: "tool", agent: "researcher", duration_ms: 1234 });
    render(<TurnCard turn={turn} active={false} dimmed={false} onSelect={vi.fn()} />);
    expect(screen.getByText("researcher")).toBeTruthy();
    expect(screen.getByText("1.2s")).toBeTruthy();
  });

  it("shows an error badge when status is error", () => {
    const turn = baseTurn({ id: "t#0", idx: 0, role: "tool", status: "error" });
    render(<TurnCard turn={turn} active={false} dimmed={false} onSelect={vi.fn()} />);
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("marks the turn labelable and focusable, and fires onSelect on focus", () => {
    const onSelect = vi.fn();
    const turn = baseTurn({ id: "t#0", idx: 0, role: "assistant", labelable: true });
    const { container } = render(<TurnCard turn={turn} active={false} dimmed={false} onSelect={onSelect} />);
    const card = container.querySelector('[data-turn-id="t#0"]')!;
    expect(card.getAttribute("data-labelable")).toBe("true");
    expect(card.getAttribute("tabindex")).toBe("0");
  });

  it("renders an activity cascade beneath an assistant turn with activity", () => {
    const turn = baseTurn({ id: "t#0", idx: 0, role: "assistant" });
    render(
      <TurnCard
        turn={turn}
        active={false}
        dimmed={false}
        onSelect={vi.fn()}
        activity={[
          {
            kind: "tool",
            interaction: {
              call: { id: "c1", name: "search", arguments: "{}" },
              result: null,
              durationMs: null,
              status: null,
              statusMessage: null,
            },
          },
        ]}
      />,
    );
    expect(screen.getByText("search")).toBeTruthy();
  });
});
