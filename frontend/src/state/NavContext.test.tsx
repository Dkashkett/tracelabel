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
import { Header } from "@/components/Header";
import { useKeyboard } from "@/keyboard/useKeyboard";
import { NavProvider, useController } from "./NavContext";

const apiMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  getQueue: vi.fn(),
  getTrace: vi.fn(),
  putAnnotation: vi.fn(),
  getProgress: vi.fn(),
}));

vi.mock("@/api/client", () => ({ api: apiMock }));

const baseSession: SessionInfo = {
  task: "completion-test",
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
  useKeyboard();
  const controller = useController();
  return (
    <div>
      <div data-testid="trace-id">{controller.trace.trace.id}</div>
      <div data-testid="workflow">{controller.state.workflow}</div>
      <div data-testid="finished">{String(controller.isFinished)}</div>
      <div data-testid="drawer">{controller.drawerOpen ? "open" : "closed"}</div>
      <div data-testid="history-length">{controller.state.history.length}</div>
      <div data-testid="draft">{JSON.stringify(controller.state.draft)}</div>
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
      <button type="button" onClick={() => controller.goToTrace(2)}>
        trace two
      </button>
      <button type="button" onClick={() => controller.setField("verdict", "pass")}>
        choose pass
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
        <Header />
        <Probe />
      </NavProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  session = structuredClone(baseSession);
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

  it("returns from the finished screen to the final committed target", async () => {
    queue = [entry("a", 0)];
    traces = { a: trace("a") };

    renderProvider();
    await screen.findByTestId("trace-id");
    fireEvent.click(screen.getByRole("button", { name: "commit" }));
    await waitFor(() => expect(screen.getByTestId("finished").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "← Back" }));

    await waitFor(() => expect(screen.getByTestId("workflow").textContent).toBe("review"));
    expect(screen.getByTestId("trace-id").textContent).toBe("a");
    expect(screen.getByTestId("history-length").textContent).toBe("0");
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

describe("NavProvider target history", () => {
  it("always advances and Back returns to the exact committed target with its values", async () => {
    localStorage.setItem("tracelabel.autoAdvance", "0");
    session.fields = [
      {
        name: "verdict",
        label: "Verdict",
        type: "single_select",
        required: true,
        options: ["pass", "fail"],
      },
    ];
    const done = annotation({
      target_type: "trace",
      target_id: "b",
      status: "labeled",
      values: { verdict: "pass" },
    });
    queue = [entry("a", 0), entry("b", 1, { labeled: 1 }), entry("c", 2)];
    traces = { a: trace("a"), b: trace("b", done), c: trace("c") };

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    expect((screen.getByRole("button", { name: "← Back" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "choose pass" }));
    fireEvent.click(screen.getByRole("button", { name: "commit" }));

    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("c"));
    await waitFor(() => expect(apiMock.putAnnotation).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "← Back" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));

    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    await waitFor(() =>
      expect(screen.getByTestId("draft").textContent).toBe('{"verdict":"pass"}'),
    );
  });

  it("walks manual session history repeatedly with Back and the u shortcut", async () => {
    queue = [entry("a", 0), entry("b", 1), entry("c", 2)];
    traces = { a: trace("a"), b: trace("b"), c: trace("c") };

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    fireEvent.click(screen.getByRole("button", { name: "trace one" }));
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("b"));
    fireEvent.click(screen.getByRole("button", { name: "trace two" }));
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("c"));

    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("b"));
    fireEvent.keyDown(window, { key: "u" });
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    expect((screen.getByRole("button", { name: "← Back" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("adds skipped targets to history", async () => {
    session.fields = [
      {
        name: "verdict",
        label: "Verdict",
        type: "single_select",
        required: false,
        options: ["pass", "fail"],
      },
    ];
    queue = [entry("a", 0), entry("b", 1)];
    traces = { a: trace("a"), b: trace("b") };

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    fireEvent.click(screen.getByRole("button", { name: "choose pass" }));
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("b"));
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));

    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    expect(screen.getByTestId("draft").textContent).toBe("{}");
  });

  it("restores the committed draft when Back is used before the save settles", async () => {
    session.fields = [
      {
        name: "verdict",
        label: "Verdict",
        type: "single_select",
        required: true,
        options: ["pass", "fail"],
      },
    ];
    let pendingInput: AnnotationIn | undefined;
    let resolvePut: ((value: AnnotationOut) => void) | undefined;
    apiMock.putAnnotation.mockImplementation(
      (input: AnnotationIn) =>
        new Promise<AnnotationOut>((resolve) => {
          pendingInput = input;
          resolvePut = resolve;
        }),
    );
    queue = [entry("a", 0), entry("b", 1)];
    traces = { a: trace("a"), b: trace("b") };

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    fireEvent.click(screen.getByRole("button", { name: "choose pass" }));
    fireEvent.click(screen.getByRole("button", { name: "commit" }));
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("b"));
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));

    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    expect(screen.getByTestId("draft").textContent).toBe('{"verdict":"pass"}');
    resolvePut?.(annotation(pendingInput!));
    await waitFor(() => expect(apiMock.putAnnotation).toHaveBeenCalledTimes(1));
  });

  it("does not advance or add history when validation fails", async () => {
    session.fields = [
      {
        name: "verdict",
        label: "Verdict",
        type: "single_select",
        required: true,
        options: ["pass", "fail"],
      },
    ];
    queue = [entry("a", 0), entry("b", 1)];
    traces = { a: trace("a"), b: trace("b") };

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    fireEvent.click(screen.getByRole("button", { name: "commit" }));

    expect(screen.getByTestId("trace-id").textContent).toBe("a");
    expect(screen.getByTestId("history-length").textContent).toBe("0");
    expect(apiMock.putAnnotation).not.toHaveBeenCalled();
  });

  it("cancels a pending cross-trace advance when Back is used", async () => {
    let resolveB: ((value: TraceDetail) => void) | undefined;
    const pendingB = new Promise<TraceDetail>((resolve) => {
      resolveB = resolve;
    });
    queue = [entry("a", 0), entry("b", 1)];
    traces = { a: trace("a"), b: trace("b") };
    apiMock.getTrace.mockImplementation(async (id: string) => {
      if (id === "b") return pendingB;
      return structuredClone(traces[id]);
    });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
    fireEvent.click(screen.getByRole("button", { name: "commit" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "← Back" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    resolveB?.(structuredClone(traces.b));

    await waitFor(() => expect(screen.getByTestId("trace-id").textContent).toBe("a"));
  });
});
