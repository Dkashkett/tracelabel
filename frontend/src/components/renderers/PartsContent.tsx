import { HtmlFrame } from "./HtmlFrame";
import { JsonTree } from "./JsonTree";
import { TextContent } from "./TextContent";

interface Part {
  type?: string;
  text?: string;
  json_string?: string;
  html?: string;
}

function renderPart(part: Part, i: number) {
  switch (part.type) {
    case "text":
      return <TextContent key={i} content={part.text ?? ""} />;
    case "json":
      return <JsonTree key={i} content={part.json_string ?? ""} />;
    case "html":
      return <HtmlFrame key={i} content={part.html ?? ""} />;
    default:
      return <TextContent key={i} content={JSON.stringify(part)} />;
  }
}

export function PartsContent({ content }: { content: string }) {
  let parts: Part[];
  try {
    const parsed = JSON.parse(content);
    parts = Array.isArray(parsed) ? (parsed as Part[]) : [];
  } catch {
    return <TextContent content={content} />;
  }
  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <div key={i}>{renderPart(p, i)}</div>
      ))}
    </div>
  );
}
