// Co-located test for F2-SETTINGS (docs/refactor-plan.md §4). Mocks the API client
// module the same way routes/index.test.tsx does, so the real
// useSettings/usePatchSettings hooks run against a fake settingsApi.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings as SettingsType } from "@/api/types";
import Settings from "./index";

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
}));

vi.mock("@/api/client", () => ({ settingsApi: apiMock }));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Settings />
    </QueryClientProvider>,
  );
}

const initialSettings: SettingsType = {
  annotator: "dan",
  default_llm_model: "gpt-4o-mini",
  theme: "system",
};

describe("Settings screen", () => {
  beforeEach(() => {
    apiMock.getSettings.mockReset();
    apiMock.patchSettings.mockReset();
    apiMock.getSettings.mockResolvedValue(initialSettings);
    apiMock.patchSettings.mockImplementation(async (patch) => ({
      ...initialSettings,
      ...patch,
    }));
  });

  it("loads and displays current settings", async () => {
    renderSettings();

    expect(screen.getByText("Loading settings…")).toBeTruthy();

    expect(await screen.findByDisplayValue("dan")).toBeTruthy();
    expect(screen.getByDisplayValue("gpt-4o-mini")).toBeTruthy();
    expect(screen.getByRole("button", { name: "system" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("editing a field and saving calls patchSettings with the expected patch", async () => {
    renderSettings();

    const annotatorInput = await screen.findByDisplayValue("dan");
    fireEvent.change(annotatorInput, { target: { value: "sam" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiMock.patchSettings).toHaveBeenCalledWith({
        annotator: "sam",
        default_llm_model: "gpt-4o-mini",
        theme: "system",
      });
    });

    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("theme selection works", async () => {
    renderSettings();

    await screen.findByDisplayValue("dan");

    const darkButton = screen.getByRole("button", { name: "dark" });
    fireEvent.click(darkButton);
    expect(darkButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "system" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiMock.patchSettings).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "dark" }),
      );
    });
  });
});
