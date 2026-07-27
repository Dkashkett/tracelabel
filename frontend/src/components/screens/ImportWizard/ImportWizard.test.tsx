// Co-located screen test for F2-IMPORT (docs/refactor-plan.md §4). Mocks
// @/api/client's importsApi/jobsApi (used by api/queries/{imports,jobs}.ts) the same
// way routes/index.test.tsx mocks the labeling api, wrapped in QueryClientProvider +
// a memory router supplying :project.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportPreview, JobStatus, TraceDetail } from "@/api/types";
import ImportWizard from "./index";

const apiMock = vi.hoisted(() => ({
  importsApi: {
    previewImport: vi.fn(),
    startImport: vi.fn(),
  },
  jobsApi: {
    getJob: vi.fn(),
  },
}));

vi.mock("@/api/client", () => ({
  importsApi: apiMock.importsApi,
  jobsApi: apiMock.jobsApi,
}));

const sampleTrace: TraceDetail = {
  trace: { id: "t1", metadata: {} },
  turns: [
    {
      id: "t1#0",
      idx: 0,
      role: "user",
      content: "What's the weather in Boston?",
      content_type: "text",
      labelable: false,
      metadata: {},
    },
    {
      id: "t1#1",
      idx: 1,
      role: "assistant",
      content: "It's sunny and 72F.",
      content_type: "text",
      labelable: true,
      metadata: {},
    },
  ],
  annotations: {},
  suggestions: {},
};

function renderWizard() {
  const router = createMemoryRouter(
    [
      { path: "/p/:project/import", element: <ImportWizard /> },
      { path: "/p/:project", element: <div>Project home</div> },
    ],
    { initialEntries: ["/p/demo/import"] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ImportWizard", () => {
  it("previews a source and renders the detected adapter, trace count, and a trace turn", async () => {
    const preview: ImportPreview = {
      adapter: "adk",
      trace_count: 412,
      traces: [sampleTrace],
      errors: [],
      notes: ["1 trace skipped: missing role"],
    };
    apiMock.importsApi.previewImport.mockResolvedValue(preview);

    renderWizard();

    fireEvent.change(screen.getByPlaceholderText("…or paste trace JSON / text here"), {
      target: { value: '{"turns": []}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Detected: adk · 412 traces")).toBeTruthy();
    expect(screen.getByText("1 trace skipped: missing role")).toBeTruthy();
    expect(screen.getByText("It's sunny and 72F.")).toBeTruthy();
    expect(apiMock.importsApi.previewImport).toHaveBeenCalledWith("demo", {
      content: '{"turns": []}',
      from: undefined,
      as_documents: undefined,
      include_all_spans: undefined,
    });
  });

  it("shows a validation error instead of previewing when the active field is empty", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText("Paste some content or drop a file first.")).toBeTruthy();
    expect(apiMock.importsApi.previewImport).not.toHaveBeenCalled();
  });

  it("requires a path (not content) once server-local path mode is selected", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("radio", { name: "Server-local path" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText("Enter a server-local path first.")).toBeTruthy();
    expect(apiMock.importsApi.previewImport).not.toHaveBeenCalled();
  });

  it("imports and polls the job to completion, showing a success message", async () => {
    const preview: ImportPreview = {
      adapter: "ctf",
      trace_count: 1,
      traces: [sampleTrace],
      errors: [],
      notes: [],
    };
    apiMock.importsApi.previewImport.mockResolvedValue(preview);
    apiMock.importsApi.startImport.mockResolvedValue({ job_id: "job_1" });

    const running: JobStatus = { job_id: "job_1", state: "running", progress: 0.5, result: null, error: null };
    const done: JobStatus = { job_id: "job_1", state: "done", progress: 1, result: null, error: null };
    apiMock.jobsApi.getJob.mockResolvedValueOnce(running).mockResolvedValue(done);

    renderWizard();

    fireEvent.change(screen.getByPlaceholderText("…or paste trace JSON / text here"), {
      target: { value: "some content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("Detected: ctf · 1 traces");

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(apiMock.importsApi.startImport).toHaveBeenCalled());
    expect(await screen.findByText(/Import complete\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to project" }).getAttribute("href")).toBe("/p/demo");
  });

  it("shows the job error on an import failure", async () => {
    const preview: ImportPreview = {
      adapter: "ctf",
      trace_count: 1,
      traces: [sampleTrace],
      errors: [],
      notes: [],
    };
    apiMock.importsApi.previewImport.mockResolvedValue(preview);
    apiMock.importsApi.startImport.mockResolvedValue({ job_id: "job_2" });

    const errored: JobStatus = {
      job_id: "job_2",
      state: "error",
      progress: 0,
      result: null,
      error: "adapter 'adk' could not parse this file",
    };
    apiMock.jobsApi.getJob.mockResolvedValue(errored);

    renderWizard();

    fireEvent.change(screen.getByPlaceholderText("…or paste trace JSON / text here"), {
      target: { value: "some content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("Detected: ctf · 1 traces");

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("adapter 'adk' could not parse this file")).toBeTruthy();
  });
});
