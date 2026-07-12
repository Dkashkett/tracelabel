import { useState } from "react";
import { useController } from "@/state/NavContext";
import { getTheme, setTheme, type Theme } from "@/state/prefs";

export function Header() {
  const { session, progress, state, toggleAutoAdvance, setCheatOpen } = useController();
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const total = progress?.total ?? 0;
  const done = (progress?.labeled ?? 0) + (progress?.skipped ?? 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  function flipTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  return (
    <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
      <span className="font-semibold">{session.task}</span>
      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
        {session.level}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {done}/{total}
        </span>
      </div>

      <label className="flex items-center gap-1 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={state.autoAdvance}
          onChange={toggleAutoAdvance}
          className="accent-sky-500"
        />
        auto-advance
      </label>
      <button
        type="button"
        onClick={flipTheme}
        className="rounded px-1.5 py-0.5 text-base hover:bg-slate-100 dark:hover:bg-slate-800"
        title="toggle theme"
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
      <button
        type="button"
        onClick={() => setCheatOpen(true)}
        className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        title="keyboard shortcuts (?)"
      >
        ?
      </button>
    </header>
  );
}
