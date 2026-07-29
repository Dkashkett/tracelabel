import { Dialog } from "@/components/ui/dialog";
import { KeyboardIcon } from "@/components/ui/icons";
import { useController } from "@/state/NavContext";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Navigate",
    rows: [
      ["j / k", "Next / previous labelable turn"],
      ["n / p", "Next / previous trace"],
      ["u", "Back through visited targets"],
      ["v (hold)", "Peek at all turns"],
    ],
  },
  {
    title: "Label",
    rows: [
      ["1–9", "Select an option"],
      ["r", "Focus the first text field"],
      ["Tab", "Cycle through form fields"],
      ["Enter", "Commit and continue"],
      ["s", "Skip target and continue"],
    ],
  },
  {
    title: "View",
    rows: [
      ["x", "Expand or collapse activity"],
      ["Esc", "Return to navigation"],
      ["?", "Toggle keyboard shortcuts"],
    ],
  },
];

export function CheatSheet() {
  const { cheatOpen, setCheatOpen } = useController();

  return (
    <Dialog
      open={cheatOpen}
      onOpenChange={setCheatOpen}
      title={
        <span className="inline-flex items-center gap-2">
          <KeyboardIcon className="h-4 w-4 text-accent-strong" />
          Keyboard shortcuts
        </span>
      }
      description="Move through a labeling task without leaving the keyboard."
      className="max-w-lg"
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title} className={group.title === "Label" ? "sm:row-span-2" : ""}>
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {group.title}
            </h3>
            <dl className="mt-2 divide-y divide-line">
              {group.rows.map(([keys, description]) => (
                <div key={keys} className="flex items-start gap-3 py-2.5">
                  <dt className="w-16 shrink-0">
                    <kbd className="rounded-md border border-line-strong bg-surface-inset px-1.5 py-1 font-mono text-[10px] font-medium text-ink">
                      {keys}
                    </kbd>
                  </dt>
                  <dd className="text-xs leading-5 text-ink-muted">{description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
