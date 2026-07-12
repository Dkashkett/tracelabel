export function TextContent({ content }: { content: string }) {
  // verbatim, never reformatted (invariant #1)
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</div>;
}
