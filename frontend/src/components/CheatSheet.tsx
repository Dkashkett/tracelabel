import { useController } from "@/state/NavContext";

const ROWS: [string, string][] = [
  ["j / k", "next / prev labelable turn"],
  ["n / p", "next / prev trace"],
  ["1–9", "select option N of the primary select"],
  ["Enter", "commit + next target (Cmd/Ctrl+Enter from a textarea)"],
  ["r", "focus first text field"],
  ["Tab / Shift+Tab", "cycle form fields"],
  ["Esc", "back to NAV"],
  ["s", "skip target + advance"],
  ["u", "back through visited targets (pre-filled)"],
  ["v (hold)", "peek: un-dim all turns"],
  ["?", "toggle this cheat sheet"],
];

export function CheatSheet() {
  const { cheatOpen, setCheatOpen } = useController();
  if (!cheatOpen) return null;
  // Non-focus-trapping overlay (06 §1): clicking away closes it, focus is never stolen.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => setCheatOpen(false)}
    >
      <div
        className="w-[26rem] max-w-[90vw] rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setCheatOpen(false)}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {ROWS.map(([keys, desc]) => (
              <tr key={keys} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-4 align-top">
                  <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold dark:bg-slate-800">
                    {keys}
                  </kbd>
                </td>
                <td className="py-1 text-slate-600 dark:text-slate-300">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
