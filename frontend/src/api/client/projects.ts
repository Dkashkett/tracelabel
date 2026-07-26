import { json } from "./http";
import type { ProjectCreate, ProjectDetail, ProjectSummary } from "../types";
import * as mockProjects from "@/mocks/projects";
import { listTasks } from "@/mocks/tasks";

export interface ProjectsApi {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: ProjectCreate): Promise<ProjectSummary>;
  getProject(slug: string): Promise<ProjectDetail>;
  deleteProject(slug: string): Promise<void>;
}

export const httpProjectsApi: ProjectsApi = {
  listProjects: () => fetch("/api/projects").then(json<ProjectSummary[]>),
  createProject: (input) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<ProjectSummary>),
  getProject: (slug) =>
    fetch(`/api/projects/${encodeURIComponent(slug)}`).then(json<ProjectDetail>),
  deleteProject: (slug) =>
    fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" }).then(() => undefined),
};

export const mockProjectsApi: ProjectsApi = {
  listProjects: async () => mockProjects.listProjects(),
  createProject: async (input) => mockProjects.createProject(input),
  getProject: async (slug) => {
    const project = mockProjects.getProject(slug);
    if (!project) throw new Error(`unknown project '${slug}'`);
    const { sources, ...summary } = project;
    return { ...summary, sources, tasks: listTasks(slug) };
  },
  deleteProject: async (slug) => {
    mockProjects.deleteProject(slug);
  },
};
