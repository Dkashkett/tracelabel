import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Turn } from "@/api/types";
import { HandoffDivider } from "./HandoffDivider";

describe("HandoffDivider", () => {
  it("prefers metadata.from/to over the raw name", () => {
    const turn: Turn = {
      id: "t#0",
      idx: 0,
      role: "event",
      content: "",
      content_type: "text",
      labelable: false,
      metadata: { from: "Researcher", to: "Writer" },
      kind: "handoff",
      name: "Researcher -> Writer",
    };
    render(<HandoffDivider turn={turn} />);
    expect(screen.getByText("Researcher → Writer")).toBeTruthy();
  });

  it("falls back to the raw name when metadata lacks from/to", () => {
    const turn: Turn = {
      id: "t#0",
      idx: 0,
      role: "event",
      content: "",
      content_type: "text",
      labelable: false,
      metadata: {},
      kind: "handoff",
      name: "custom handoff label",
    };
    render(<HandoffDivider turn={turn} />);
    expect(screen.getByText("custom handoff label")).toBeTruthy();
  });
});
