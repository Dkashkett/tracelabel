import { json } from "./http";
import type { SchemaImpactOut, SchemaOut, SchemaPatch } from "../types";
import * as mockTasks from "@/mocks/tasks";

// A 409 response from PATCH .../schema carries a SchemaImpactOut instead of a SchemaOut.
// Callers distinguish the two by catching SchemaImpactError.
export class SchemaImpactError extends Error {
  constructor(public impact: SchemaImpactOut) {
    super("schema change requires confirmation");
  }
}

export interface SchemaApi {
  getSchema(projectSlug: string, taskName: string): Promise<SchemaOut>;
  // Set confirm=true to apply a breaking change anyway (the rubric editor's
  // "Remove anyway" action); otherwise a breaking change throws SchemaImpactError.
  patchSchema(
    projectSlug: string,
    taskName: string,
    patch: SchemaPatch,
    confirm?: boolean,
  ): Promise<SchemaOut>;
}

const schemaUrl = (projectSlug: string, taskName: string) =>
  `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${encodeURIComponent(taskName)}/schema`;

export const httpSchemaApi: SchemaApi = {
  getSchema: (projectSlug, taskName) => fetch(schemaUrl(projectSlug, taskName)).then(json<SchemaOut>),
  patchSchema: async (projectSlug, taskName, patch, confirm = false) => {
    const res = await fetch(`${schemaUrl(projectSlug, taskName)}?confirm=${confirm}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.status === 409) throw new SchemaImpactError((await res.json()) as SchemaImpactOut);
    return json<SchemaOut>(res);
  },
};

export const mockSchemaApi: SchemaApi = {
  getSchema: async (projectSlug, taskName) => mockTasks.getSchema(projectSlug, taskName),
  patchSchema: async (projectSlug, taskName, patch, confirm = false) => {
    const impact = mockTasks.analyzeSchemaImpact(projectSlug, taskName, patch);
    if (impact.breaking && !confirm) throw new SchemaImpactError(impact);
    return mockTasks.patchSchema(projectSlug, taskName, patch);
  },
};
