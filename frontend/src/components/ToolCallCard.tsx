import { useState } from "react";
import type { ToolCall } from "@/api/types";

export function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded border border-amber-300 bg-amber-50 text-xs dark:border-amber-700/60 dark:bg-amber-900/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left font-medium text-amber-800 dark:text-amber-300"
      >
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        <span>⚙ {call.name}</span>
      </button>
      {open && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-amber-200 px-2 py-1 font-mono dark:border-amber-800">
          {call.arguments}
        </pre>
      )}
    </div>
  );
}
