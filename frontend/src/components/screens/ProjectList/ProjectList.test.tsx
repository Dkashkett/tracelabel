import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/api/types";
import ProjectList from "./index";

const apiMock = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@/api/client", () => ({ projectsApi: apiMock }));

const projects: ProjectSummary[] = [
  { slug: "support-triage", name: "Support Triage", created_at: "2026-06-30T09:00:00Z", task_count: 2, source_count: 2 },
  { slug: "eval-harness", name: "Eval Harness", created_at: "2026-06-15T08:00:00Z", task_count: 1, source_count: 1 },
];

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.confirm = vi.fn(() => true);
});

describe("ProjectList", () => {
  it("renders a card for each project", async () => {
    apiMock.listProjects.mockResolvedValue(projects);
    renderScreen();

    expect(await screen.findByText("Support Triage")).toBeTruthy();
    expect(screen.getByText("Eval Harness")).toBeTruthy();
    expect(screen.getByText("2 tasks")).toBeTruthy();
    expect(screen.getByText("1 task")).toBeTruthy();
  });

  it("shows the first-run welcome when there are no projects", async () => {
    apiMock.listProjects.mockResolvedValue([]);
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Turn your traces into golden data." }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create your first project" })).toBeTruthy();
    expect(screen.getByText("Your data stays on this machine")).toBeTruthy();
  });

  it("creates a project via the dialog and closes it", async () => {
    apiMock.listProjects.mockResolvedValue([]);
    const created: ProjectSummary = {
      slug: "my-new-project",
      name: "My New Project",
      created_at: "2026-07-27T00:00:00Z",
      task_count: 0,
      source_count: 0,
    };
    apiMock.createProject.mockResolvedValue(created);
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: "Create your first project" }));

    expect(screen.getByRole("dialog", { name: "New project" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(apiMock.createProject).toHaveBeenCalledWith({ name: "My New Project", notes: undefined }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("calls the delete mutation after confirming", async () => {
    apiMock.listProjects.mockResolvedValue(projects);
    apiMock.deleteProject.mockResolvedValue(undefined);
    renderScreen();

    await screen.findByText("Support Triage");
    fireEvent.click(screen.getByRole("button", { name: "Delete Support Triage" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(apiMock.deleteProject).toHaveBeenCalledWith("support-triage"));
  });
});
