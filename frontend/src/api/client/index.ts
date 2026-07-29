// Barrel: one object per domain, picking the HTTP or mock implementation per
// VITE_MOCK exactly like the old client.ts did (same env var, same mechanism —
// just split by domain now that there are 9 domains instead of 1).
import { httpExportsApi, mockExportsApi, type ExportsApi } from "./exports";
import { httpImportsApi, mockImportsApi, type ImportsApi } from "./imports";
import { httpJobsApi, mockJobsApi, type JobsApi } from "./jobs";
import { httpLabelingApi, mockLabelingApi, type LabelingApi } from "./labeling";
import { httpProjectsApi, mockProjectsApi, type ProjectsApi } from "./projects";
import { httpSchemaApi, mockSchemaApi, SchemaImpactError, type SchemaApi } from "./schema";
import { httpSettingsApi, mockSettingsApi, type SettingsApi } from "./settings";
import { httpSourcesApi, mockSourcesApi, type SourcesApi } from "./sources";
import { httpTasksApi, mockTasksApi, type TasksApi } from "./tasks";

const MOCK = import.meta.env.VITE_MOCK === "1";

export const settingsApi: SettingsApi = MOCK ? mockSettingsApi : httpSettingsApi;
export const projectsApi: ProjectsApi = MOCK ? mockProjectsApi : httpProjectsApi;
export const sourcesApi: SourcesApi = MOCK ? mockSourcesApi : httpSourcesApi;
export const importsApi: ImportsApi = MOCK ? mockImportsApi : httpImportsApi;
export const tasksApi: TasksApi = MOCK ? mockTasksApi : httpTasksApi;
export const schemaApi: SchemaApi = MOCK ? mockSchemaApi : httpSchemaApi;
export const labelingApi: LabelingApi = MOCK ? mockLabelingApi : httpLabelingApi;
export const exportsApi: ExportsApi = MOCK ? mockExportsApi : httpExportsApi;
export const jobsApi: JobsApi = MOCK ? mockJobsApi : httpJobsApi;

// Backward-compat alias: the current labeling view (state/NavContext.tsx) imports
// `api` directly and only ever calls the five labeling methods. Keep it working
// unchanged — that file is owned by a later packet, not this one.
export const api: LabelingApi = labelingApi;

export { SchemaImpactError };

export type {
  ExportsApi,
  ImportsApi,
  JobsApi,
  LabelingApi,
  ProjectsApi,
  SchemaApi,
  SettingsApi,
  SourcesApi,
  TasksApi,
};
