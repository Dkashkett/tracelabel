import { cn } from "@/lib/utils";

export function SavedDot({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        status === "saving" ? "text-ink-faint" : "text-pass",
      )}
    >
      <span className={cn(status === "saving" && "animate-pulse")}>●</span>
      {status === "saving" ? "saving…" : "saved"}
    </span>
  );
}
