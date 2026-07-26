import { json } from "./http";
import type { SourceOut } from "../types";
import { listSources } from "@/mocks/projects";

export interface SourcesApi {
  listSources(projectSlug: string): Promise<SourceOut[]>;
}

export const httpSourcesApi: SourcesApi = {
  listSources: (projectSlug) =>
    fetch(`/api/projects/${encodeURIComponent(projectSlug)}/sources`).then(json<SourceOut[]>),
};

export const mockSourcesApi: SourcesApi = {
  listSources: async (projectSlug) => listSources(projectSlug),
};
