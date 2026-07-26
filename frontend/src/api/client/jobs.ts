import { json } from "./http";
import type { JobStatus } from "../types";
import { getJob } from "@/mocks/imports";

export interface JobsApi {
  getJob(jobId: string): Promise<JobStatus>;
}

export const httpJobsApi: JobsApi = {
  getJob: (jobId) => fetch(`/api/jobs/${encodeURIComponent(jobId)}`).then(json<JobStatus>),
};

export const mockJobsApi: JobsApi = {
  getJob: async (jobId) => {
    const job = getJob(jobId);
    if (!job) throw new Error(`unknown job '${jobId}'`);
    return job;
  },
};
