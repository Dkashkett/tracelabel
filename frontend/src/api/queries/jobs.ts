import { useQuery } from "@tanstack/react-query";
import { jobsApi } from "../client";

export const jobsKeys = {
  detail: (jobId: string) => ["jobs", jobId] as const,
};

// Polls a running job (import / suggestion run) until it settles. Consumers pass
// refetchInterval themselves if they want to stop polling once status is terminal —
// kept simple here since only the caller knows what "done" means for its screen.
export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: jobsKeys.detail(jobId ?? ""),
    queryFn: () => jobsApi.getJob(jobId as string),
    enabled: !!jobId,
  });
}
