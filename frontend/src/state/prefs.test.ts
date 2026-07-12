import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getTheme, setTheme } from "./prefs";

describe("theme preference", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("defaults missing and invalid preferences to dark", () => {
    expect(getTheme()).toBe("dark");
    localStorage.setItem("tracelabel.theme", "system");
    expect(getTheme()).toBe("dark");
  });

  it("preserves an explicitly saved light preference", () => {
    localStorage.setItem("tracelabel.theme", "light");
    expect(getTheme()).toBe("light");
  });

  it("applies and persists theme toggles", () => {
    setTheme("dark");
    expect(localStorage.getItem("tracelabel.theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    setTheme("light");
    expect(localStorage.getItem("tracelabel.theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies a resolved default before a caller renders", () => {
    applyTheme(getTheme());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
