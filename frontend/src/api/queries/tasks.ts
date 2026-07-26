import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "../client";
import type { SuggestIn, TaskCreate, TaskPatch } from "../types";
import { projectsKeys } from "./projects";

export const tasksKeys = {
  list: (projectSlug: string) => ["projects", projectSlug, "tasks"] as const,
  detail: (projectSlug: string, taskName: string) =>
    ["projects", projectSlug, "tasks", taskName] as const,
  items: (projectSlug: string, taskName: string, page: number, pageSize: number) =>
    ["projects", projectSlug, "tasks", taskName, "items", page, pageSize] as const,
  stats: (projectSlug: string, taskName: string) =>
    ["projects", projectSlug, "tasks", taskName, "stats"] as const,
};

export function useTasks(projectSlug: string | undefined) {
  return useQuery({
    queryKey: tasksKeys.list(projectSlug ?? ""),
    queryFn: () => tasksApi.listTasks(projectSlug as string),
    enabled: !!projectSlug,
  });
}

export function useTask(projectSlug: string | undefined, taskName: string | undefined) {
  return useQuery({
    queryKey: tasksKeys.detail(projectSlug ?? "", taskName ?? ""),
    queryFn: () => tasksApi.getTask(projectSlug as string, taskName as string),
    enabled: !!projectSlug && !!taskName,
  });
}

export function useCreateTask(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskCreate) => tasksApi.createTask(projectSlug, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksKeys.list(projectSlug) });
      void qc.invalidateQueries({ queryKey: projectsKeys.detail(projectSlug) });
    },
  });
}

export function usePatchTask(projectSlug: string, taskName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: TaskPatch) => tasksApi.patchTask(projectSlug, taskName, patch),
    onSuccess: (task) => qc.setQueryData(tasksKeys.detail(projectSlug, taskName), task),
  });
}

export function useItems(
  projectSlug: string | undefined,
  taskName: string | undefined,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: tasksKeys.items(projectSlug ?? "", taskName ?? "", page, pageSize),
    queryFn: () => tasksApi.getItems(projectSlug as string, taskName as string, page, pageSize),
    enabled: !!projectSlug && !!taskName,
  });
}

export function useStats(projectSlug: string | undefined, taskName: string | undefined) {
  return useQuery({
    queryKey: tasksKeys.stats(projectSlug ?? "", taskName ?? ""),
    queryFn: () => tasksApi.getStats(projectSlug as string, taskName as string),
    enabled: !!projectSlug && !!taskName,
  });
}

export function useStartSuggestions(projectSlug: string, taskName: string) {
  return useMutation({
    mutationFn: (input: SuggestIn) => tasksApi.startSuggestions(projectSlug, taskName, input),
  });
}
