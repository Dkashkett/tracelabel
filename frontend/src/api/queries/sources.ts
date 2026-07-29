import { useQuery } from "@tanstack/react-query";
import { sourcesApi } from "../client";

export const sourcesKeys = {
  list: (projectSlug: string) => ["projects", projectSlug, "sources"] as const,
};

export function useSources(projectSlug: string | undefined) {
  return useQuery({
    queryKey: sourcesKeys.list(projectSlug ?? ""),
    queryFn: () => sourcesApi.listSources(projectSlug as string),
    enabled: !!projectSlug,
  });
}
