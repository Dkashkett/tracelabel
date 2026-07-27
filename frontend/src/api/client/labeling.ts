// The original single-task labeling API (session/queue/trace/annotations/progress).
// Field shapes are unchanged from the pre-refactor client.ts, but the paths now nest
// under /api/projects/{project}/tasks/{task}/... instead of the old flat /api/*, per
// docs/refactor-plan.md §3 ("only their paths change").
import { json } from "./http";
import type { AnnotationIn, AnnotationOut, Progress, QueueEntry, SessionInfo, TraceDetail } from "../types";

export interface LabelingApi {
  getSession(project: string, task: string): Promise<SessionInfo>;
  getQueue(project: string, task: string): Promise<QueueEntry[]>;
  getTrace(project: string, task: string, traceId: string): Promise<TraceDetail>;
  putAnnotation(project: string, task: string, ann: AnnotationIn): Promise<AnnotationOut>;
  getProgress(project: string, task: string): Promise<Progress>;
}

const taskBase = (project: string, task: string) =>
  `/api/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}`;

// Fetch base is same-origin (""); vite.config.ts proxies /api → 127.0.0.1:8377 in dev.
export const httpLabelingApi: LabelingApi = {
  getSession: (project, task) =>
    fetch(`${taskBase(project, task)}/session`).then(json<SessionInfo>),
  getQueue: (project, task) => fetch(`${taskBase(project, task)}/queue`).then(json<QueueEntry[]>),
  getTrace: (project, task, traceId) =>
    fetch(`${taskBase(project, task)}/traces/${encodeURIComponent(traceId)}`).then(
      json<TraceDetail>,
    ),
  putAnnotation: (project, task, ann) =>
    fetch(`${taskBase(project, task)}/annotations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ann),
    }).then(json<AnnotationOut>),
  getProgress: (project, task) =>
    fetch(`${taskBase(project, task)}/progress`).then(json<Progress>),
};

// Mock implementation lives in mocks/labeling.ts (owned there); re-exported here so this
// module is the one-stop place to see both implementations of LabelingApi.
export { mockLabelingApi } from "@/mocks/labeling";
