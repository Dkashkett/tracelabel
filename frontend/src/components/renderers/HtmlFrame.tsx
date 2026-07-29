import { useState } from "react";

export function HtmlFrame({ content }: { content: string }) {
  const [source, setSource] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setSource((s) => !s)}
        className="mb-2 rounded-md px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint outline-none hover:bg-surface-raised hover:text-ink-muted focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {source ? "view rendered" : "view source"}
      </button>
      {source ? (
        <pre className="whitespace-pre-wrap break-words font-mono">{content}</pre>
      ) : (
        // Empty sandbox attr: no scripts, no same-origin, no forms, no popups. Traces are
        // untrusted input — this is a hard security requirement (06 §4). Untrusted HTML must
        // only ever reach the DOM through this sandboxed iframe, never via raw innerHTML.
        <iframe
          sandbox=""
          srcDoc={content}
          title="html content"
          className="h-64 w-full rounded-xl border border-line-strong bg-white"
        />
      )}
    </div>
  );
}
