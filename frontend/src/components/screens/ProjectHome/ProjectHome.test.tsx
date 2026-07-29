import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "@/api/types";
import ProjectHome from "./index";

const apiMock = vi.hoisted(() => ({
  projectsApi: {
    getProject: vi.fn(),
  },
}));

vi.mock("@/api/client", () => ({
  projectsApi: apiMock.projectsApi,
}));

const project: ProjectDetail = {
  slug: "support-triage",
  name: "Support Triage",
  created_at: "2026-06-01T00:00:00Z",
  notes: "Escalation labeling",
  tasks: [
    {
      name: "escalation-risk",
      level: "turn",
      schema_hash: "sha256:a",
      compat_hash: "sha256:b",
      updated_at: "2026-07-01T00:00:00Z",
      total: 100,
      addressed: 40,
      queue_scope: { type: "all" },
    },
  ],
  sources: [
    {
      id: 1,
      name: "zendesk.jsonl",
      path: "/data/zendesk.jsonl",
      adapter: "ctf",
      imported_at: "2026-06-30T00:00:00Z",
      trace_count: 100,
    },
    {
      id: 2,
      name: "intercom.jsonl",
      path: "/data/intercom.jsonl",
      adapter: "ctf",
      imported_at: "2026-06-30T00:00:00Z",
      trace_count: 20,
    },
  ],
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:project" element={<ProjectHome />} />
          <Route path="/p/:project/t/:task/label" element={<div>label view</div>} />
          <Route path="/p/:project/tasks/new" element={<div>new task wizard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectHome", () => {
  it("renders tasks and sources from the project detail", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    renderAt("/p/support-triage");

    expect(await screen.findByText("Support Triage")).toBeTruthy();
    expect(screen.getByText("escalation-risk")).toBeTruthy();
    expect(screen.getByText("zendesk.jsonl")).toBeTruthy();
  });

  it("shows empty states when there are no tasks or sources", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue({ ...project, tasks: [], sources: [] });
    renderAt("/p/support-triage");

    expect(await screen.findByText("No tasks yet — create one to start labeling.")).toBeTruthy();
    expect(screen.getByText("No sources imported yet.")).toBeTruthy();
  });

  it("navigates to the new task wizard from the New task button", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    renderAt("/p/support-triage");

    await screen.findByText("Support Triage");
    fireEvent.click(screen.getByText("New task"));

    expect(await screen.findByText("new task wizard")).toBeTruthy();
  });

  it("navigates to the label view when clicking anywhere on the task card", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    renderAt("/p/support-triage");

    await screen.findByText("Support Triage");
    fireEvent.click(screen.getByRole("link", { name: "escalation-risk" }));

    expect(await screen.findByText("label view")).toBeTruthy();
  });
});
