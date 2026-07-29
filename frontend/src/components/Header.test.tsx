import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

const useControllerMock = vi.hoisted(() => vi.fn());

vi.mock("@/state/NavContext", () => ({
  useController: useControllerMock,
}));

describe("Header", () => {
  it("keeps the wordmark and useful trace stats without count chips or the brand badge", () => {
    useControllerMock.mockReturnValue({
      session: { task: "quality-review", level: "trace" },
      completionCounts: { total: 10, labeled: 2, skipped: 1 },
      canGoBack: false,
      goBack: vi.fn(),
      setCheatOpen: vi.fn(),
      trace: {
        trace: { id: "trace-1", metadata: {} },
        turns: [
          {
            id: "trace-1#0",
            idx: 0,
            role: "assistant",
            content: "",
            content_type: "text",
            labelable: false,
            metadata: {},
            agent: "Researcher",
            tool_calls: [{ id: "call-1", name: "search", arguments: "{}" }],
          },
          {
            id: "trace-1#1",
            idx: 1,
            role: "tool",
            content: "failed",
            content_type: "text",
            labelable: false,
            metadata: {},
            tool_call_id: "call-1",
            status: "error",
          },
        ],
        annotations: {},
        suggestions: {},
        review_of: {},
      },
    });

    render(
      <MemoryRouter initialEntries={["/p/example/t/quality-review/label"]}>
        <Routes>
          <Route path="/p/:project/t/:task/label" element={<Header />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "tracelabel" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText("tl")).toBeNull();
    expect(screen.queryByText("2 msg")).toBeNull();
    expect(screen.queryByText("1 tool")).toBeNull();
    expect(screen.getByText("1 agent")).toBeTruthy();
    expect(screen.getByText("1 error")).toBeTruthy();
  });
});
