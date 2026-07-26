// The original single-task labeling API (session/queue/trace/annotations/progress).
// Paths and shapes are unchanged from the pre-refactor client.ts — only the file
// location moved, per docs/refactor-plan.md §3.
import { json } from "./http";
import type { AnnotationIn, AnnotationOut, Progress, QueueEntry, SessionInfo, TraceDetail } from "../types";

export interface LabelingApi {
  getSession(): Promise<SessionInfo>;
  getQueue(): Promise<QueueEntry[]>;
  getTrace(traceId: string): Promise<TraceDetail>;
  putAnnotation(ann: AnnotationIn): Promise<AnnotationOut>;
  getProgress(): Promise<Progress>;
}

// Fetch base is same-origin (""); vite.config.ts proxies /api → 127.0.0.1:8377 in dev.
export const httpLabelingApi: LabelingApi = {
  getSession: () => fetch("/api/session").then(json<SessionInfo>),
  getQueue: () => fetch("/api/queue").then(json<QueueEntry[]>),
  getTrace: (traceId) =>
    fetch(`/api/traces/${encodeURIComponent(traceId)}`).then(json<TraceDetail>),
  putAnnotation: (ann) =>
    fetch("/api/annotations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ann),
    }).then(json<AnnotationOut>),
  getProgress: () => fetch("/api/progress").then(json<Progress>),
};

// Mock implementation lives in mocks/labeling.ts (owned there); re-exported here so this
// module is the one-stop place to see both implementations of LabelingApi.
export { mockLabelingApi } from "@/mocks/labeling";
