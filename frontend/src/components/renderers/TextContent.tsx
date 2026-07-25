export function TextContent({ content }: { content: string }) {
  // verbatim, never reformatted (invariant #1)
  return <div className="whitespace-pre-wrap break-words leading-relaxed">{content}</div>;
}
