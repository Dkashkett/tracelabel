import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { AnnotationIn, AnnotationOut } from "./types";

export const qk = {
  session: ["session"] as const,
  queue: ["queue"] as const,
  progress: ["progress"] as const,
  trace: (id: string) => ["trace", id] as const,
};

export function useSession() {
  return useQuery({
    queryKey: qk.session,
    queryFn: () => api.getSession(),
    staleTime: Infinity, // schema is fixed for a serve process
  });
}

export function useQueue() {
  return useQuery({ queryKey: qk.queue, queryFn: () => api.getQueue() });
}

export function useTrace(traceId: string | undefined) {
  return useQuery({
    queryKey: qk.trace(traceId ?? ""),
    queryFn: () => api.getTrace(traceId as string),
    enabled: !!traceId,
  });
}

export function useProgress() {
  return useQuery({ queryKey: qk.progress, queryFn: () => api.getProgress() });
}

export function usePutAnnotation() {
  return useMutation<AnnotationOut, Error, AnnotationIn>({
    mutationFn: (ann) => api.putAnnotation(ann),
  });
}
