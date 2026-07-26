import { json } from "./http";
import type { ImportIn, ImportPreview, ImportPreviewIn, JobRef } from "../types";
import { previewImport, startImport } from "@/mocks/imports";

export interface ImportsApi {
  previewImport(projectSlug: string, input: ImportPreviewIn): Promise<ImportPreview>;
  startImport(projectSlug: string, input: ImportIn): Promise<JobRef>;
}

export const httpImportsApi: ImportsApi = {
  previewImport: (projectSlug, input) =>
    fetch(`/api/projects/${encodeURIComponent(projectSlug)}/imports/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<ImportPreview>),
  startImport: (projectSlug, input) =>
    fetch(`/api/projects/${encodeURIComponent(projectSlug)}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json<JobRef>),
};

export const mockImportsApi: ImportsApi = {
  previewImport: async (_projectSlug, input) => previewImport(input),
  startImport: async (projectSlug, input) => startImport(projectSlug, input),
};
