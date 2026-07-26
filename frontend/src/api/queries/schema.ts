import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { schemaApi } from "../client";
import type { SchemaPatch } from "../types";
import { tasksKeys } from "./tasks";

export const schemaKeys = {
  detail: (projectSlug: string, taskName: string) =>
    ["projects", projectSlug, "tasks", taskName, "schema"] as const,
};

export function useSchema(projectSlug: string | undefined, taskName: string | undefined) {
  return useQuery({
    queryKey: schemaKeys.detail(projectSlug ?? "", taskName ?? ""),
    queryFn: () => schemaApi.getSchema(projectSlug as string, taskName as string),
    enabled: !!projectSlug && !!taskName,
  });
}

// Callers pass confirm=true after the user accepts a SchemaImpactOut warning
// (thrown as SchemaImpactError on the first, unconfirmed call).
export function usePatchSchema(projectSlug: string, taskName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ patch, confirm }: { patch: SchemaPatch; confirm?: boolean }) =>
      schemaApi.patchSchema(projectSlug, taskName, patch, confirm),
    onSuccess: (schema) => {
      qc.setQueryData(schemaKeys.detail(projectSlug, taskName), schema);
      void qc.invalidateQueries({ queryKey: tasksKeys.detail(projectSlug, taskName) });
    },
  });
}
