import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "../client";
import type { ProjectCreate } from "../types";

export const projectsKeys = {
  list: ["projects"] as const,
  detail: (slug: string) => ["projects", slug] as const,
};

export function useProjects() {
  return useQuery({ queryKey: projectsKeys.list, queryFn: () => projectsApi.listProjects() });
}

export function useProject(slug: string | undefined) {
  return useQuery({
    queryKey: projectsKeys.detail(slug ?? ""),
    queryFn: () => projectsApi.getProject(slug as string),
    enabled: !!slug,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectCreate) => projectsApi.createProject(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: projectsKeys.list }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => projectsApi.deleteProject(slug),
    onSuccess: () => void qc.invalidateQueries({ queryKey: projectsKeys.list }),
  });
}
