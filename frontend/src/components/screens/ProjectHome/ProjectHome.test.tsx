import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProjectDetail, TaskDetail } from "@/api/types";
import ProjectHome from "./index";

const apiMock = vi.hoisted(() => ({
  projectsApi: {
    getProject: vi.fn(),
  },
  tasksApi: {
    createTask: vi.fn(),
  },
}));

vi.mock("@/api/client", () => ({
  projectsApi: apiMock.projectsApi,
  tasksApi: apiMock.tasksApi,
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
  ],
};

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: "/p/:project", element: <ProjectHome /> }],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
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

  it("creates a task with the expected TaskCreate shape", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    const created: TaskDetail = {
      name: "new_task",
      level: "turn",
      fields: [{ name: "verdict", label: "Verdict", type: "single_select", options: ["pass", "fail"], required: true }],
      label_roles: ["assistant"],
      shuffle: false,
      annotator: "dan",
      schema_hash: "sha256:x",
      compat_hash: "sha256:y",
      queue_scope: { type: "all" },
      llm_model: null,
      llm_temperature: null,
      llm_max_tokens: null,
      suggest_instructions: null,
      review_of: null,
      review_labels_from: "judge",
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    };
    apiMock.tasksApi.createTask.mockResolvedValue(created);

    renderAt("/p/support-triage");
    await screen.findByText("Support Triage");

    fireEvent.click(screen.getByText("New task"));
    fireEvent.change(screen.getByPlaceholderText("escalation-risk"), {
      target: { value: "new_task" },
    });
    fireEvent.click(screen.getByText("Create task"));

    await screen.findByText("Support Triage");
    expect(apiMock.tasksApi.createTask).toHaveBeenCalledWith(
      "support-triage",
      expect.objectContaining({ name: "new_task", level: "turn" }),
    );
  });
});
