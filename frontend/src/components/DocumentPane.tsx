import type { DocumentDetail } from "@/api/types";
import { ContentByType } from "./renderers/ContentByType";

export function DocumentPane({ doc }: { doc: DocumentDetail }) {
  return (
    <div className="h-full overflow-auto bg-bg bg-[radial-gradient(circle_at_50%_0%,rgb(var(--accent)/0.035),transparent_32rem)] p-6 text-sm text-ink sm:p-8">
      <article className="mx-auto max-w-[880px] rounded-2xl border border-line-strong/70 bg-surface/70 p-5 shadow-panel sm:p-8">
        <ContentByType content={doc.content} contentType={doc.content_type} />
      </article>
    </div>
  );
}
