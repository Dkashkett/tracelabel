import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueEntry, SessionInfo, TraceDetail } from "@/api/types";
import { NavProvider } from "@/state/NavContext";
import { AnnotationPane } from "./AnnotationPane";
import { TracePane } from "./TracePane";

const apiMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  getQueue: vi.fn(),
  getTrace: vi.fn(),
  putAnnotation: vi.fn(),
  getProgress: vi.fn(),
}));

vi.mock("@/api/client", () => ({ api: apiMock }));

const baseSession: SessionInfo = {
  task: "trace-pane-test",
  level: "trace",
  fields: [],
  label_roles: ["assistant"],
  annotator: "tester",
  schema_hash: "sha256:test",
  shuffle: false,
};

let session: SessionInfo;
let queue: QueueEntry[];
let traces: Record<string, TraceDetail>;

function entry(traceId: string, position: number, nTargets = 1): QueueEntry {
  return { trace_id: traceId, position, n_targets: nTargets, n_labeled: 0, n_skipped: 0 };
}

function renderPane({ annotation = false }: { annotation?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NavProvider>
        <TracePane />
        {annotation && <AnnotationPane />}
      </NavProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  session = structuredClone(baseSession);
  queue = [];
  traces = {};
  vi.clearAllMocks();

  apiMock.getSession.mockImplementation(async () => structuredClone(session));
  apiMock.getQueue.mockImplementation(async () => queue.map((item) => ({ ...item })));
  apiMock.getTrace.mockImplementation(async (id: string) => structuredClone(traces[id]));
  apiMock.getProgress.mockImplementation(async () => ({
    unit: "traces",
    total: queue.length,
    labeled: 0,
    skipped: 0,
  }));
});

describe("TracePane document dispatch", () => {
  it("renders the DocumentPane when the trace has a document", async () => {
    queue = [entry("d1", 0)];
    traces = {
      d1: {
        trace: { id: "d1", metadata: {} },
        turns: [],
        document: { content: "This is the document body.", content_type: "text" },
        annotations: {},
        suggestions: {},
      },
    };

    renderPane();

    expect(await screen.findByText("This is the document body.")).toBeTruthy();
  });

  it("falls back to the turn view when the trace has no document", async () => {
    queue = [entry("t1", 0)];
    traces = {
      t1: {
        trace: { id: "t1", metadata: {} },
        turns: [
          {
            id: "t1#0",
            idx: 0,
            role: "user",
            content: "conversation body text",
            content_type: "text",
            labelable: false,
            metadata: {},
          },
        ],
        annotations: {},
        suggestions: {},
      },
    };

    renderPane();

    await screen.findByText("conversation body text");
    expect(screen.queryByText("This is the document body.")).toBeNull();
  });
});

describe("TracePane activity cascade", () => {
  it("merges a silent (content-less, non-labelable) tool-calling turn into the reply that follows, with steps shown as rows immediately", async () => {
    queue = [entry("trace-tools", 0)];
    traces = {
      "trace-tools": {
        trace: { id: "trace-tools", metadata: {} },
        turns: [
          {
            id: "trace-tools#0",
            idx: 0,
            role: "assistant",
            content: "",
            content_type: "text",
            tool_calls: [
              { id: "call_search", name: "search", arguments: '{"q":"weather"}' },
              { id: "call_fetch", name: "fetch", arguments: '{"url":"example.test"}' },
            ],
            labelable: false,
            metadata: {},
          },
          {
            id: "trace-tools#1",
            idx: 1,
            role: "tool",
            content: '{"search_result":"sunny"}',
            content_type: "json",
            tool_call_id: "call_search",
            name: "search",
            labelable: false,
            metadata: {},
          },
          {
            id: "trace-tools#2",
            idx: 2,
            role: "tool",
            content: '{"fetch_result":"details"}',
            content_type: "json",
            tool_call_id: "call_fetch",
            name: "fetch",
            labelable: false,
            metadata: {},
          },
          {
            id: "trace-tools#3",
            idx: 3,
            role: "assistant",
            content: "The final answer stays chronological.",
            content_type: "text",
            labelable: false,
            metadata: {},
          },
        ],
        annotations: {},
        suggestions: {},
      },
    };

    const { container } = renderPane();
    await screen.findByText("The final answer stays chronological.");

    // trace-tools#0 has no content and isn't labelable, so it folds into the reply bubble
    // instead of rendering as its own empty turn. (Nested tool-step rows also carry
    // data-turn-id for their result turn, so exclude those to count top-level turns only.)
    expect(
      Array.from(container.querySelectorAll("[data-turn-id]:not([data-tool-call])")).map((node) =>
        node.getAttribute("data-turn-id"),
      ),
    ).toEqual(["trace-tools#3"]);

    // steps render as rows immediately, no summary click required
    expect(
      Array.from(container.querySelectorAll("[data-tool-call]")).map((node) =>
        node.getAttribute("data-tool-call"),
      ),
    ).toEqual(["call_search", "call_fetch"]);
    expect(screen.getByText("search")).toBeTruthy();
    expect(screen.getByText("fetch")).toBeTruthy();
    expect(screen.queryByText(/search_result/)).toBeNull(); // steps collapsed until clicked individually

    const searchButton = container.querySelector('[data-tool-call="call_search"] button');
    fireEvent.click(searchButton!);
    expect(screen.getByText(/search_result/)).toBeTruthy();
    expect(screen.queryByText(/fetch_result/)).toBeNull(); // only the clicked step expanded
  });

  it("keeps unmatched results standalone and shows a fallback for calls with no result", async () => {
    queue = [entry("partial-tools", 0)];
    traces = {
      "partial-tools": {
        trace: { id: "partial-tools", metadata: {} },
        turns: [
          {
            id: "partial-tools#0",
            idx: 0,
            role: "assistant",
            content: "Calling lookup.",
            content_type: "text",
            tool_calls: [{ id: "missing", name: "lookup", arguments: "{}" }],
            labelable: false,
            metadata: {},
          },
          {
            id: "partial-tools#1",
            idx: 1,
            role: "tool",
            content: "unmatched result remains visible",
            content_type: "text",
            tool_call_id: "different-id",
            name: "other",
            labelable: false,
            metadata: {},
          },
        ],
        annotations: {},
        suggestions: {},
      },
    };

    const { container } = renderPane();
    await screen.findByText("unmatched result remains visible");

    expect(container.querySelector('[data-turn-id="partial-tools#1"]')).toBeTruthy();

    const card = container.querySelector('[data-tool-call="missing"]');
    expect(card?.textContent).toContain("lookup");
    fireEvent.click(card!.querySelector("button")!);
    expect(screen.getByText("No matching result in this trace.")).toBeTruthy();
  });

  it("keeps a labelable nested tool result reachable and focusable, auto-expanding its cascade when it becomes active", async () => {
    session.level = "turn";
    session.label_roles = ["assistant", "tool"];
    queue = [entry("turn-tools", 0, 3)];
    traces = {
      "turn-tools": {
        trace: { id: "turn-tools", metadata: {} },
        turns: [
          {
            id: "turn-tools#0",
            idx: 0,
            role: "assistant",
            content: "",
            content_type: "text",
            tool_calls: [{ id: "call_1", name: "lookup", arguments: '{"id":42}' }],
            labelable: true,
            metadata: {},
          },
          {
            id: "turn-tools#1",
            idx: 1,
            role: "tool",
            content: "standalone tool evidence",
            content_type: "text",
            tool_call_id: "call_1",
            name: "lookup",
            labelable: true,
            metadata: {},
          },
          {
            id: "turn-tools#2",
            idx: 2,
            role: "assistant",
            content: "Later assistant response.",
            content_type: "text",
            labelable: true,
            metadata: {},
          },
        ],
        annotations: {},
        suggestions: {},
      },
    };

    const { container } = renderPane({ annotation: true });
    await screen.findByText(/turn #0/i);

    // the tool result nests under its assistant call; only two top-level turn rows exist
    expect(
      Array.from(container.querySelectorAll('[data-turn-role="assistant"]')).map((node) =>
        node.getAttribute("data-turn-id"),
      ),
    ).toEqual(["turn-tools#0", "turn-tools#2"]);

    // the assistant call itself starts active, so its cascade auto-opens with arguments visible
    const card = await waitFor(() => {
      const el = container.querySelector('[data-tool-call="call_1"]');
      expect(el?.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
      return el;
    });
    expect(screen.getByText(/"id":42/)).toBeTruthy();

    const toolTurn = container.querySelector<HTMLElement>('[data-tool-call="call_1"]');
    expect(toolTurn?.getAttribute("data-labelable")).toBe("true");
    expect(toolTurn?.getAttribute("data-turn-idx")).toBe("1");
    fireEvent.focus(toolTurn!);

    await waitFor(() => {
      expect(toolTurn?.getAttribute("data-active")).toBe("true");
    });
    expect(screen.getByText(/turn #1/i)).toBeTruthy();
    expect(card).toBeTruthy();
  });
});
