import { json } from "./http";
import type { Settings, SettingsPatch } from "../types";
import * as mockSettings from "@/mocks/settings";

export interface SettingsApi {
  getSettings(): Promise<Settings>;
  patchSettings(patch: SettingsPatch): Promise<Settings>;
}

export const httpSettingsApi: SettingsApi = {
  getSettings: () => fetch("/api/settings").then(json<Settings>),
  patchSettings: (patch) =>
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<Settings>),
};

export const mockSettingsApi: SettingsApi = {
  getSettings: async () => mockSettings.getSettings(),
  patchSettings: async (patch) => mockSettings.patchSettings(patch),
};
