import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Turn } from "@/api/types";
import { EventCard } from "./EventCard";

function eventTurn(overrides: Partial<Turn>): Turn {
  return {
    id: "t#0",
    idx: 0,
    role: "event",
    content: "",
    content_type: "text",
    labelable: false,
    metadata: {},
    kind: "retrieval",
    ...overrides,
  };
}

describe("EventCard", () => {
  it("shows the kind name, duration, and expands metadata on click", () => {
    const turn = eventTurn({
      name: "vector_search",
      duration_ms: 64,
      metadata: { top_k: 3, index: "policies-v3" },
    });
    const { container } = render(<EventCard turn={turn} dimmed={false} />);
    expect(screen.getByText("vector_search")).toBeTruthy();
    expect(screen.getByText("64ms")).toBeTruthy();
    expect(container.querySelector("[data-event-kind]")?.getAttribute("data-event-kind")).toBe(
      "retrieval",
    );

    expect(screen.queryByText(/top_k/)).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/top_k/)).toBeTruthy();
  });

  it("shows an error badge and status message for an errored event", () => {
    const turn = eventTurn({
      name: "guardrail_check",
      kind: "guardrail",
      status: "error",
      status_message: "blocked: pii detected",
    });
    render(<EventCard turn={turn} dimmed={false} />);
    expect(screen.getByText("error")).toBeTruthy();
    expect(screen.getByText("blocked: pii detected")).toBeTruthy();
  });

  it("has no expand toggle when there is no metadata", () => {
    const turn = eventTurn({ name: "span_only" });
    render(<EventCard turn={turn} dimmed={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("applies dimmed opacity when instructed", () => {
    const { container } = render(<EventCard turn={eventTurn({})} dimmed />);
    expect(container.firstElementChild?.className).toContain("opacity-60");
  });
});
