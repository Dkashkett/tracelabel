import type {
  AnnotationIn,
  AnnotationOut,
  Progress,
  QueueEntry,
  SessionInfo,
  TraceDetail,
} from "./types";
import { mockApi } from "@/mocks/fixtures";

export interface Api {
  getSession(): Promise<SessionInfo>;
  getQueue(): Promise<QueueEntry[]>;
  getTrace(traceId: string): Promise<TraceDetail>;
  putAnnotation(ann: AnnotationIn): Promise<AnnotationOut>;
  getProgress(): Promise<Progress>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// Fetch base is same-origin (""); vite.config.ts proxies /api → 127.0.0.1:8377 in dev.
const httpApi: Api = {
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

const MOCK = import.meta.env.VITE_MOCK === "1";

export const api: Api = MOCK ? mockApi : httpApi;
