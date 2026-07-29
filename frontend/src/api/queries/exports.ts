import { useMutation } from "@tanstack/react-query";
import { exportsApi } from "../client";
import type { ExportQuery } from "../client/exports";

// Exports are a one-shot file download, not cached data — a mutation (not a query)
// is the right shape even though it's semantically a GET, since callers trigger it
// on click and want the Blob back to hand to the browser's download machinery.
export function useExportTask(projectSlug: string, taskName: string) {
  return useMutation({
    mutationFn: (query?: ExportQuery) => exportsApi.exportTask(projectSlug, taskName, query),
  });
}
