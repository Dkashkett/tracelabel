export type Theme = "light" | "dark";

const AUTO_ADVANCE_KEY = "tracelabel.autoAdvance";
const THEME_KEY = "tracelabel.theme";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / disabled storage
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort; a prefs write failing must never break labeling
  }
}

export function getAutoAdvance(): boolean {
  return read(AUTO_ADVANCE_KEY) !== "0"; // ON by default (06 §2.2)
}

export function setAutoAdvance(on: boolean): void {
  write(AUTO_ADVANCE_KEY, on ? "1" : "0");
}

export function getTheme(): Theme {
  const saved = read(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "dark";
}

export function setTheme(theme: Theme): void {
  write(THEME_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}
