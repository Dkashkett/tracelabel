import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "@/api/types";
import ExportWizard from "./index";

const apiMock = vi.hoisted(() => ({
  projectsApi: {
    getProject: vi.fn(),
  },
  exportsApi: {
    exportTask: vi.fn(),
  },
}));

vi.mock("@/api/client", () => ({
  projectsApi: apiMock.projectsApi,
  exportsApi: apiMock.exportsApi,
}));

const project: ProjectDetail = {
  slug: "support-triage",
  name: "Support Triage",
  created_at: "2026-06-01T00:00:00Z",
  notes: "",
  tasks: [
    {
      name: "escalation-risk",
      level: "turn",
      schema_hash: "sha256:a",
      compat_hash: "sha256:b",
      updated_at: "2026-07-01T00:00:00Z",
      total: 412,
      addressed: 272,
      queue_scope: { type: "all" },
    },
  ],
  sources: [],
};

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/p/support-triage/t/escalation-risk/export"]}>
        <Routes>
          <Route path="/p/:project/t/:task/export" element={<ExportWizard />} />
          <Route path="/p/:project" element={<div>project home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ExportWizard", () => {
  beforeEach(() => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    apiMock.exportsApi.exportTask.mockResolvedValue(
      new Blob(['{"target_id":"trace_01"}'], { type: "application/x-ndjson" }),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:export"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults to JSONL and offers CSV as the only other file format", async () => {
    renderWizard();

    expect(await screen.findByRole("heading", { name: "Export annotations" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /JSON Lines/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("radio", { name: /CSV/ })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("sends the reviewed choices and starts a named download", async () => {
    renderWizard();
    await screen.findByRole("heading", { name: "Export annotations" });

    fireEvent.click(screen.getByRole("radio", { name: /CSV/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("radio", { name: /Labeled only/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Include original source data/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getAllByText("escalation-risk-annotations.csv")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Export & download/ }));

    await waitFor(() => {
      expect(apiMock.exportsApi.exportTask).toHaveBeenCalledWith(
        "support-triage",
        "escalation-risk",
        { format: "csv", status: "labeled", joined: true },
      );
    });
    expect(await screen.findByText(/Download started/)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });
});
