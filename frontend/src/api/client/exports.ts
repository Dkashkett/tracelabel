import { exportTask } from "@/mocks/tasks";

export interface ExportQuery {
  format?: "csv" | "jsonl";
  status?: "labeled" | "skipped" | "all";
  joined?: boolean;
}

export interface ExportsApi {
  // Streaming file download: returns a Blob rather than json<T>() since the response
  // isn't JSON. Callers turn this into a download via URL.createObjectURL.
  exportTask(projectSlug: string, taskName: string, query?: ExportQuery): Promise<Blob>;
}

function exportUrl(projectSlug: string, taskName: string, query: ExportQuery): string {
  const params = new URLSearchParams();
  if (query.format) params.set("format", query.format);
  if (query.status) params.set("status", query.status);
  if (query.joined) params.set("joined", "true");
  const qs = params.toString();
  const base = `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${encodeURIComponent(taskName)}/export`;
  return qs ? `${base}?${qs}` : base;
}

export const httpExportsApi: ExportsApi = {
  exportTask: async (projectSlug, taskName, query = {}) => {
    const res = await fetch(exportUrl(projectSlug, taskName, query));
    if (!res.ok) throw new Error(res.statusText);
    return res.blob();
  },
};

export const mockExportsApi: ExportsApi = {
  exportTask: async (projectSlug, taskName) => exportTask(projectSlug, taskName),
};
