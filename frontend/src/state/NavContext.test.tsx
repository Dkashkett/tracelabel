import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnnotationIn,
  AnnotationOut,
  QueueEntry,
  SessionInfo,
  TraceDetail,
} from "@/api/types";
import { NavProvider, useController } from "./NavContext";

const apiMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  getQueue: vi.fn(),
  getTrace: vi.fn(),
  putAnnotation: vi.fn(),
  getProgress: vi.fn(),
}));

vi.mock("@/api/client", () => ({ api: apiMock }));

const session: SessionInfo = {
  task: "completion-test",
  level: "trace",
  fields: [],
  label_roles: ["assistant"],
  annotator: "tester",
  schema_hash: "sha256:test",
  shuffle: false,
};

let queue: QueueEntry[];
let traces: Record<string, TraceDetail>;

function annotation(ann: AnnotationIn): AnnotationOut {
  return {
    ...ann,
    prefill_model: ann.prefill_model ?? null,
    schema_hash: session.schema_hash,
    annotator: session.annotator,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
  };
}

function trace(id: string, existing?: AnnotationOut): TraceDetail {
  return {
    trace: { id, metadata: {} },
    turns: [],
    annotations: existing ? { [id]: existing } : {},
    suggestions: {},
  };
}

function entry(
  traceId: string,
  position: number,
  counts: { labeled?: number; skipped?: number } = {},
): QueueEntry {
  return {
    trace_id: traceId,
    position,
    n_targets: 1,
    n_labeled: counts.labeled ?? 0,
    n_skipped: counts.skipped ?? 0,
  };
}

function Probe() {
  const controller = useController();
  return (
    <div>
      <div data-testid="trace-id">{controller.trace.trace.id}</div>
      <div data-testid="workflow">{controller.state.workflow}</div>
      <div data-testid="finished">{String(controller.isFinished)}</div>
      <div data-testid="drawer">{controller.drawerOpen ? "open" : "closed"}</div>
      <button type="button" onClick={controller.commit}>
        commit
      </button>
      <button type="button" onClick={controller.skip}>
        skip
      </button>
      <button type="button" onClick={() => controller.goToTrace(0)}>
        trace zero
      </button>
      <button type="button" onClick={() => controller.goToTrace(1)}>
        trace one
      </button>
      <button type="button" onClick={() => controller.setDrawerOpen(true)}>
        review traces
      </button>
    </div>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NavProvider>
        <Probe />
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
    total: queue.reduce((sum, item) => sum + item.n_targets, 0),
    labeled: queue.reduce((sum, item) => sum + item.n_labeled, 0),
    skipped: queue.reduce((sum, item) => sum + item.n_skipped, 0),
  }));
  apiMock.putAnnotation.mockImplementation(async (input: AnnotationIn) => {
    const out = annotation(input);
    const td = traces[input.target_id];
    const previous = td.annotations[input.target_id];
    const queueEntry = queue.find((item) => item.trace_id === input.target_id)!;
    if (previous?.status === "labeled") queueEntry.n_labeled--;
    if (previous?.status === "skipped") queueEntry.n_skipped--;
    if (input.status === "labeled") queueEntry.n_labeled++;
    if (input.status === "skipped") queueEntry.n_skipped++;
    td.annotations[input.target_id] = out;
    return out;
  });
});

describe("NavProvider completion workflow", () => {
  it("opens an already-complete dataset on the finished screen with a collapsed drawer", async () => {
    const done = annotation({
      target_type: "trace",
      target_id: "a",
      status: "labeled",
      values: {},
    });
    queue = [entry("a", 0, { labeled: 1 })];
    traces = { a: trace("a", done) };

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("finished").textContent).toBe("true"));
    expect(screen.getByTestId("drawer").textContent).toBe("closed");
  });

  it("shows completion only after the final commit has persisted", async () => {
    queue = [entry("a", 0)];
    traces = { a: trace("a") };

    renderProvider();
    await screen.findByTestId("trace-id");
    fireEvent.click(screen.getByRole("button", { name: "commit" }));

    await waitFor(() => expect(screen.getByTestId("finished").textContent).toBe("true"));
    expect(apiMock.putAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ target_id: "a", status: "labeled" }),
    );
  });

  it("shows completion after the final skip has persisted", async () => {
    queue = [entry("a", 0)];
    traces = { a: trace("a") };

    renderProvider();
    await screen.findByTestId("trace-id");
    fireEvent.click(screen.getByRole("button", { name: "skip" }));

    await waitFor(() => expect(screen.getByTestId("finished").textContent).toBe("true"));
    expect(apiMock.putAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ target_id: "a", status: "skipped" }),
    );
  });

  it("wraps from the physical end to an unfinished earlier target", async () => {
    queue = [entry("a", 0), entry("b", 1)];
    traces = { a: trace("a"), b: trace("b") };

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    fireEvent.click(screen.getByRole("button", { name: "trace one" }));
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("b"));
    fireEvent.click(screen.getByRole("button", { name: "skip" }));

    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    expect(screen.getByTestId("finished").textContent).toBe("false");
  });

  it("opens the drawer and returns to editable review mode when a trace is selected", async () => {
    const done = annotation({
      target_type: "trace",
      target_id: "a",
      status: "labeled",
      values: {},
    });
    queue = [entry("a", 0, { labeled: 1 })];
    traces = { a: trace("a", done) };

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("finished").textContent).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "review traces" }));
    expect(screen.getByTestId("drawer").textContent).toBe("open");
    fireEvent.click(screen.getByRole("button", { name: "trace zero" }));

    await waitFor(() => expect(screen.getByTestId("finished").textContent).toBe("false"));
    expect(screen.getByTestId("workflow").textContent).toBe("review");
  });
});
