import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueEntry, SessionInfo, TraceDetail } from "@/api/types";
import { NavProvider } from "@/state/NavContext";
import { TracePane } from "./TracePane";

const apiMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  getQueue: vi.fn(),
  getTrace: vi.fn(),
  putAnnotation: vi.fn(),
  getProgress: vi.fn(),
}));

vi.mock("@/api/client", () => ({ api: apiMock }));

const session: SessionInfo = {
  task: "trace-pane-test",
  level: "trace",
  fields: [],
  label_roles: ["assistant"],
  annotator: "tester",
  schema_hash: "sha256:test",
  shuffle: false,
};

let queue: QueueEntry[];
let traces: Record<string, TraceDetail>;

function entry(traceId: string, position: number): QueueEntry {
  return { trace_id: traceId, position, n_targets: 1, n_labeled: 0, n_skipped: 0 };
}

function renderPane() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NavProvider>
        <TracePane />
      </NavProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queue = [];
  traces = {};
  vi.clearAllMocks();

  apiMock.getSession.mockImplementation(async () => session);
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
