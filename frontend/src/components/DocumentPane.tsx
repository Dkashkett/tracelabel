import type { DocumentDetail } from "@/api/types";
import { ContentByType } from "./renderers/ContentByType";

export function DocumentPane({ doc }: { doc: DocumentDetail }) {
  return (
    <div className="h-full overflow-auto bg-bg p-6 text-sm text-ink">
      <ContentByType content={doc.content} contentType={doc.content_type} />
    </div>
  );
}
