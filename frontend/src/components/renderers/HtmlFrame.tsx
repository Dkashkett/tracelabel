import { useState } from "react";

export function HtmlFrame({ content }: { content: string }) {
  const [source, setSource] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setSource((s) => !s)}
        className="mb-1 text-[10px] uppercase tracking-wide text-slate-400 hover:text-slate-600"
      >
        {source ? "view rendered" : "view source"}
      </button>
      {source ? (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs">{content}</pre>
      ) : (
        // Empty sandbox attr: no scripts, no same-origin, no forms, no popups. Traces are
        // untrusted input — this is a hard security requirement (06 §4). Untrusted HTML must
        // only ever reach the DOM through this sandboxed iframe, never via raw innerHTML.
        <iframe
          sandbox=""
          srcDoc={content}
          title="html content"
          className="h-64 w-full rounded border border-slate-200 bg-white dark:border-slate-700"
        />
      )}
    </div>
  );
}
