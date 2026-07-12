import type { DocumentDetail } from "@/api/types";
import { ContentByType } from "./renderers/ContentByType";

export function DocumentPane({ doc }: { doc: DocumentDetail }) {
  return (
    <div className="h-full overflow-auto bg-white p-6 dark:bg-slate-900">
      <ContentByType content={doc.content} contentType={doc.content_type} />
    </div>
  );
}
