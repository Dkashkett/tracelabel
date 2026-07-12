import { HtmlFrame } from "./HtmlFrame";
import { JsonTree } from "./JsonTree";
import { MarkdownContent } from "./MarkdownContent";
import { PartsContent } from "./PartsContent";
import { TextContent } from "./TextContent";

export type ContentType = "text" | "json" | "html" | "parts" | "markdown";

// Shared by turn content (text|json|html|parts) and document content (text|json|html|markdown).
export function ContentByType({
  content,
  contentType,
}: {
  content: string;
  contentType: ContentType;
}) {
  switch (contentType) {
    case "text":
      return <TextContent content={content} />;
    case "json":
      return <JsonTree content={content} />;
    case "html":
      return <HtmlFrame content={content} />;
    case "parts":
      return <PartsContent content={content} />;
    case "markdown":
      return <MarkdownContent content={content} />;
  }
}
