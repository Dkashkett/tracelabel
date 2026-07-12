import { cn } from "@/lib/utils";

export function SavedDot({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        status === "saving" ? "text-slate-400" : "text-green-600 dark:text-green-400",
      )}
    >
      <span className={cn(status === "saving" && "animate-pulse")}>●</span>
      {status === "saving" ? "saving…" : "saved"}
    </span>
  );
}
