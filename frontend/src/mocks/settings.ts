import type { Settings, SettingsPatch } from "@/api/types";

// In-memory store so a PATCH in one tab of the mock UI is visible on the next GET.
const store: Settings = {
  annotator: "dan",
  default_llm_model: "gpt-4o-mini",
  theme: "system",
};

export function getSettings(): Settings {
  return { ...store };
}

export function patchSettings(patch: SettingsPatch): Settings {
  Object.assign(store, patch);
  return { ...store };
}
