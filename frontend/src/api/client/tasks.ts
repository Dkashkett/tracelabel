import { json } from "./http";
import type {
  ItemPage,
  JobRef,
  SuggestIn,
  TaskCreate,
  TaskDetail,
  TaskPatch,
  TaskStats,
  TaskSummary,
} from "../types";
import * as mockTasks from "@/mocks/tasks";

export interface TasksApi {
  listTasks(projectSlug: string): Promise<TaskSummary[]>;
  createTask(projectSlug: string, input: TaskCreate): Promise<TaskDetail>;
  getTask(projectSlug: string, taskName: string): Promise<TaskDetail>;
  patchTask(projectSlug: string, taskName: string, patch: TaskPatch): Promise<TaskDetail>;
  getItems(projectSlug: string, taskName: string, page: number, pageSize: number): Promise<ItemPage>;
  getStats(projectSlug: string, taskName: string): Promise<TaskStats>;
  startSuggestions(projectSlug: string, taskName: string, input: SuggestIn): Promise<JobRef>;
}

const base = (projectSlug: string) => `/api/projects/${encodeURIComponent(projectSlug)}/tasks`;
const taskBase = (projectSlug: string, taskName: string) =>
  `${base(projectSlug)}/${encodeURIComponent(taskName)}`;

export const httpTasksApi: TasksApi = {
  listTasks: (projectSlug) => fetch(base(projectSlug)).then(json<TaskSummary[]>),
  createTask: (projectSlug, input) =>
    fetch(base(projectSlug), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<TaskDetail>),
  getTask: (projectSlug, taskName) => fetch(taskBase(projectSlug, taskName)).then(json<TaskDetail>),
  patchTask: (projectSlug, taskName, patch) =>
    fetch(taskBase(projectSlug, taskName), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<TaskDetail>),
  getItems: (projectSlug, taskName, page, pageSize) =>
    fetch(`${taskBase(projectSlug, taskName)}/items?page=${page}&page_size=${pageSize}`).then(
      json<ItemPage>,
    ),
  getStats: (projectSlug, taskName) =>
    fetch(`${taskBase(projectSlug, taskName)}/stats`).then(json<TaskStats>),
  startSuggestions: (projectSlug, taskName, input) =>
    fetch(`${taskBase(projectSlug, taskName)}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<JobRef>),
};

export const mockTasksApi: TasksApi = {
  listTasks: async (projectSlug) => mockTasks.listTasks(projectSlug),
  createTask: async (projectSlug, input) => mockTasks.createTask(projectSlug, input),
  getTask: async (projectSlug, taskName) => {
    const task = mockTasks.getTask(projectSlug, taskName);
    if (!task) throw new Error(`unknown task '${projectSlug}/${taskName}'`);
    return task;
  },
  patchTask: async (projectSlug, taskName, patch) => mockTasks.patchTask(projectSlug, taskName, patch),
  getItems: async (projectSlug, taskName, page, pageSize) =>
    mockTasks.getItems(projectSlug, taskName, page, pageSize),
  getStats: async (projectSlug, taskName) => mockTasks.getStats(projectSlug, taskName),
  startSuggestions: async (projectSlug, taskName, input) =>
    mockTasks.startSuggestions(projectSlug, taskName, input),
};
