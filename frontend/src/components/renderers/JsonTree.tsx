import { useState } from "react";

const OPEN_DEPTH = 2; // collapsed beyond depth 2 by default (06 §4)

function Punct({ children }: { children: string }) {
  return <span className="text-ink-faint">{children}</span>;
}

function Leaf({ value }: { value: unknown }) {
  const color =
    typeof value === "string"
      ? "text-pass"
      : typeof value === "number"
        ? "text-accent-strong"
        : typeof value === "boolean"
          ? "text-warn"
          : "text-ink-faint";
  return <span className={color}>{JSON.stringify(value)}</span>;
}

function Node({ label, value, depth }: { label?: string; value: unknown; depth: number }) {
  const isContainer = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < OPEN_DEPTH);

  const key = label !== undefined ? <Punct>{`${label}: `}</Punct> : null;

  if (!isContainer) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        {key}
        <Leaf value={value} />
      </div>
    );
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const [openBrace, closeBrace] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        {key}
        <Punct>{openBrace + closeBrace}</Punct>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer text-left hover:bg-surface-raised"
      >
        <span className="inline-block w-3 text-ink-faint">{open ? "▾" : "▸"}</span>
        {key}
        <Punct>{open ? openBrace : `${openBrace}…${closeBrace} ${entries.length}`}</Punct>
      </button>
      {open && (
        <div>
          {entries.map(([k, v]) => (
            <Node key={k} label={Array.isArray(value) ? undefined : k} value={v} depth={depth + 1} />
          ))}
          <div style={{ paddingLeft: depth * 12 }}>
            <Punct>{closeBrace}</Punct>
          </div>
        </div>
      )}
    </div>
  );
}

export function JsonTree({ content }: { content: string }) {
  const [raw, setRaw] = useState(false);
  let parsed: unknown;
  let parseError = false;
  try {
    parsed = JSON.parse(content);
  } catch {
    parseError = true;
  }

  return (
    <div className="font-mono leading-relaxed">
      <button
        type="button"
        onClick={() => setRaw((r) => !r)}
        className="mb-2 rounded-md px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint outline-none hover:bg-surface-raised hover:text-ink-muted focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {raw ? "view tree" : "view raw"}
      </button>
      {raw || parseError ? (
        // verbatim string — never reformatted
        <pre className="whitespace-pre-wrap break-words">{content}</pre>
      ) : (
        <Node value={parsed} depth={0} />
      )}
    </div>
  );
}
