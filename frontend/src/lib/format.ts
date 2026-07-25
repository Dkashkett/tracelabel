export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

const PREVIEW_LENGTH = 80;

// A compact, single-line preview of tool-call arguments: valid JSON is collapsed onto
// one line (no pretty-printing whitespace), anything else is shown verbatim. Always
// truncated so a huge payload never widens a collapsed card.
export function previewArguments(args: string): string {
  let text = args;
  try {
    text = JSON.stringify(JSON.parse(args));
  } catch {
    text = args.replace(/\s+/g, " ").trim();
  }
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
}
