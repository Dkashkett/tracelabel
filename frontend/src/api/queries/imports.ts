import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importsApi } from "../client";
import type { ImportIn, ImportPreviewIn } from "../types";
import { projectsKeys } from "./projects";
import { sourcesKeys } from "./sources";

export function usePreviewImport(projectSlug: string) {
  return useMutation({
    mutationFn: (input: ImportPreviewIn) => importsApi.previewImport(projectSlug, input),
  });
}

export function useStartImport(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportIn) => importsApi.startImport(projectSlug, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sourcesKeys.list(projectSlug) });
      void qc.invalidateQueries({ queryKey: projectsKeys.detail(projectSlug) });
    },
  });
}
