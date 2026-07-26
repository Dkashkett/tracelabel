import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "../client";
import type { Settings, SettingsPatch } from "../types";

export const settingsKeys = {
  settings: ["settings"] as const,
};

export function useSettings() {
  return useQuery({ queryKey: settingsKeys.settings, queryFn: () => settingsApi.getSettings() });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation<Settings, Error, SettingsPatch>({
    mutationFn: (patch) => settingsApi.patchSettings(patch),
    onSuccess: (settings) => qc.setQueryData(settingsKeys.settings, settings),
  });
}
