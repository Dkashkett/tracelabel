import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProjectDetail, TaskDetail } from "@/api/types";
import NewTask from "./index";

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
  notes: null,
  tasks: [],
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

function makeCreatedTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
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
    ...overrides,
  };
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:project/tasks/new" element={<NewTask />} />
          <Route path="/p/:project" element={<div>project home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillName(value: string) {
  fireEvent.change(screen.getByPlaceholderText("escalation_risk"), { target: { value } });
}

describe("NewTask", () => {
  it("blocks Continue until the name is valid", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    renderAt("/p/support-triage/tasks/new");
    await screen.findByPlaceholderText("escalation_risk");

    fillName("Not Valid!");
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(
      screen.getByText(
        "Name must be lowercase letters, numbers, or underscores, starting with a letter.",
      ),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("escalation_risk")).toBeTruthy();
  });

  it("walks through all steps and creates a task", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    apiMock.tasksApi.createTask.mockResolvedValue(makeCreatedTask({ level: "trace" }));
    renderAt("/p/support-triage/tasks/new");
    await screen.findByPlaceholderText("escalation_risk");

    fillName("new_task");
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Sources step: uncheck one source, narrowing queue_scope.
    expect(screen.getByText(/zendesk\.jsonl · 100 traces/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Level step: cards, not a <select>.
    fireEvent.click(screen.getByRole("radio", { name: /Trace level/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Rubric step: defaults to Pass/fail + reasoning, already editable inline. The
    // preview is interactive, not a dead mock — clicking an option selects it and
    // typing a label updates the preview live.
    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(2);
    fireEvent.click(screen.getByText("Add field"));
    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(3);

    const previewPass = screen.getByRole("radio", { name: /pass/ });
    fireEvent.click(previewPass);
    expect(previewPass.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // Review step.
    fireEvent.click(screen.getByText("Create task"));

    expect(await screen.findByText("project home")).toBeTruthy();
    expect(apiMock.tasksApi.createTask).toHaveBeenCalledWith(
      "support-triage",
      expect.objectContaining({
        name: "new_task",
        level: "trace",
        queue_scope: { type: "source", source_ids: [2] },
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "verdict" }),
          expect.objectContaining({ name: "reasoning" }),
        ]),
      }),
    );
  });

  it("removes a rubric field before creating", async () => {
    apiMock.projectsApi.getProject.mockResolvedValue(project);
    apiMock.tasksApi.createTask.mockResolvedValue(makeCreatedTask());
    renderAt("/p/support-triage/tasks/new");
    await screen.findByPlaceholderText("escalation_risk");

    fillName("new_task");
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove field 2" }));
    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByText("Create task"));

    expect(await screen.findByText("project home")).toBeTruthy();
    expect(apiMock.tasksApi.createTask).toHaveBeenCalledWith(
      "support-triage",
      expect.objectContaining({
        fields: [expect.objectContaining({ name: "verdict" })],
      }),
    );
  });
});
