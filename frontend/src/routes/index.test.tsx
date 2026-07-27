// Router-level smoke test for F1-SHELL (docs/refactor-plan.md §4). Confirms the route
// table renders without crashing: a placeholder screen at "/", and the real labeling
// UI (NavProvider > Workspace, extracted into LabelView) at a /p/:project/t/:task/label
// route, driven against a mocked labeling API the same way NavContext.test.tsx does.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { QueueEntry, SessionInfo, TraceDetail } from "@/api/types";
import { routes } from "./index";

const apiMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  getQueue: vi.fn(),
  getTrace: vi.fn(),
  putAnnotation: vi.fn(),
  getProgress: vi.fn(),
}));

vi.mock("@/api/client", () => ({ api: apiMock }));

const session: SessionInfo = {
  task: "answer-quality",
  level: "trace",
  fields: [],
  label_roles: ["assistant"],
  annotator: "tester",
  schema_hash: "sha256:test",
  shuffle: false,
};

const queue: QueueEntry[] = [
  { trace_id: "t1", position: 0, n_targets: 1, n_labeled: 0, n_skipped: 0 },
];

const trace: TraceDetail = {
  trace: { id: "t1", metadata: {} },
  turns: [],
  annotations: {},
  suggestions: {},
};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("router shell", () => {
  it("renders the ProjectList placeholder at /", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
  });

  it("renders the real labeling UI at /p/:project/t/:task/label", async () => {
    apiMock.getSession.mockResolvedValue(session);
    apiMock.getQueue.mockResolvedValue(queue);
    apiMock.getTrace.mockResolvedValue(trace);
    apiMock.getProgress.mockResolvedValue({ labeled: 0, skipped: 0, total: 1 });

    renderAt("/p/demo/t/answer-quality/label");

    expect(await screen.findByText("answer-quality")).toBeTruthy();
  });
});
