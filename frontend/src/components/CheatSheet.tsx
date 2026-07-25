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
  ["x", "expand/collapse all activity cascades"],
  ["?", "toggle this cheat sheet"],
];

export function CheatSheet() {
  const { cheatOpen, setCheatOpen } = useController();
  if (!cheatOpen) return null;
  // Non-focus-trapping overlay (06 §1): clicking away closes it, focus is never stolen.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setCheatOpen(false)}
    >
      <div
        className="w-[26rem] max-w-[90vw] rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setCheatOpen(false)}
            className="text-ink-faint hover:text-ink-muted"
          >
            ✕
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {ROWS.map(([keys, desc]) => (
              <tr key={keys} className="border-t border-line">
                <td className="py-1 pr-4 align-top">
                  <kbd className="rounded bg-surface-raised px-1.5 py-0.5 text-xs font-semibold text-ink">
                    {keys}
                  </kbd>
                </td>
                <td className="py-1 text-ink-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
