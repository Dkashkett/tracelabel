import { useMutation, useQuery } from "@tanstack/react-query";
// Import the `api` alias, not `labelingApi` directly: existing tests mock
// `@/api/client` with `vi.mock("@/api/client", () => ({ api: apiMock }))`
// (NavContext.test.tsx, TracePane.test.tsx — both out of scope for this packet),
// so these hooks must keep going through the same binding name.
import { api as labelingApi } from "../client";
import type { AnnotationIn, AnnotationOut } from "../types";

// Query keys for the existing single-task labeling view, now scoped by project/task
// since one server serves any number of them (docs/refactor-plan.md §3 — the paths
// moved to /api/projects/{p}/tasks/{t}/..., the shapes didn't).
export const qk = {
  session: (project: string, task: string) => ["session", project, task] as const,
  queue: (project: string, task: string) => ["queue", project, task] as const,
  progress: (project: string, task: string) => ["progress", project, task] as const,
  trace: (project: string, task: string, id: string) => ["trace", project, task, id] as const,
};

export function useSession(project: string, task: string) {
  // NOTE: staleTime: Infinity was removed here (docs/refactor-plan.md §4 W0-FE).
  // The schema used to be fixed for the lifetime of a `serve` process; once the
  // rubric editor ships, a schema can change mid-session, so this query must
  // refetch like any other instead of being cached forever.
  return useQuery({
    queryKey: qk.session(project, task),
    queryFn: () => labelingApi.getSession(project, task),
  });
}

export function useQueue(project: string, task: string) {
  return useQuery({
    queryKey: qk.queue(project, task),
    queryFn: () => labelingApi.getQueue(project, task),
  });
}

export function useTrace(project: string, task: string, traceId: string | undefined) {
  return useQuery({
    queryKey: qk.trace(project, task, traceId ?? ""),
    queryFn: () => labelingApi.getTrace(project, task, traceId as string),
    enabled: !!traceId,
  });
}

export function useProgress(project: string, task: string) {
  return useQuery({
    queryKey: qk.progress(project, task),
    queryFn: () => labelingApi.getProgress(project, task),
  });
}

export function usePutAnnotation(project: string, task: string) {
  return useMutation<AnnotationOut, Error, AnnotationIn>({
    mutationFn: (ann) => labelingApi.putAnnotation(project, task, ann),
  });
}
