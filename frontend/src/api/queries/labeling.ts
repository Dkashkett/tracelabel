import { useMutation, useQuery } from "@tanstack/react-query";
// Import the `api` alias, not `labelingApi` directly: existing tests mock
// `@/api/client` with `vi.mock("@/api/client", () => ({ api: apiMock }))`
// (NavContext.test.tsx, TracePane.test.tsx — both out of scope for this packet),
// so these hooks must keep going through the same binding name.
import { api as labelingApi } from "../client";
import type { AnnotationIn, AnnotationOut } from "../types";

// Query keys for the existing single-task labeling view. Preserved verbatim from the
// old queries.ts (same names, same shapes) — state/NavContext.tsx imports this object
// directly and is not part of this packet.
export const qk = {
  session: ["session"] as const,
  queue: ["queue"] as const,
  progress: ["progress"] as const,
  trace: (id: string) => ["trace", id] as const,
};

export function useSession() {
  // NOTE: staleTime: Infinity was removed here (docs/refactor-plan.md §4 W0-FE).
  // The schema used to be fixed for the lifetime of a `serve` process; once the
  // rubric editor ships, a schema can change mid-session, so this query must
  // refetch like any other instead of being cached forever.
  return useQuery({ queryKey: qk.session, queryFn: () => labelingApi.getSession() });
}

export function useQueue() {
  return useQuery({ queryKey: qk.queue, queryFn: () => labelingApi.getQueue() });
}

export function useTrace(traceId: string | undefined) {
  return useQuery({
    queryKey: qk.trace(traceId ?? ""),
    queryFn: () => labelingApi.getTrace(traceId as string),
    enabled: !!traceId,
  });
}

export function useProgress() {
  return useQuery({ queryKey: qk.progress, queryFn: () => labelingApi.getProgress() });
}

export function usePutAnnotation() {
  return useMutation<AnnotationOut, Error, AnnotationIn>({
    mutationFn: (ann) => labelingApi.putAnnotation(ann),
  });
}
