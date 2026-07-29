import { cn } from "@/lib/utils";
import { CheckIcon } from "@/components/ui/icons";

export function SavedDot({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[9px] font-medium",
        status === "saving"
          ? "border-line bg-surface-inset text-ink-faint"
          : "border-pass/25 bg-pass/10 text-pass",
      )}
    >
      {status === "saving" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
      ) : (
        <CheckIcon className="h-3 w-3" />
      )}
      {status === "saving" ? "saving…" : "saved locally"}
    </span>
  );
}
