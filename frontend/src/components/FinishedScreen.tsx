import { Link, useParams } from "react-router-dom";
import { buttonClassName } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { useController } from "@/state/NavContext";

export function FinishedScreen() {
  const { project } = useParams<{ project: string }>();
  const { completionCounts, setDrawerOpen } = useController();
  const { labeled, skipped, total } = completionCounts;

  return (
    <main className="grid min-h-0 flex-1 place-items-center bg-bg bg-[radial-gradient(circle_at_50%_35%,rgb(var(--pass)/0.05),transparent_26rem)] px-6 py-10">
      <section className="w-full max-w-xl rounded-2xl border border-line-strong bg-surface/90 p-8 text-center shadow-panel">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-pass/25 bg-pass/10 text-pass shadow-lg shadow-black/20">
          <CheckIcon className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dataset finished</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Every target has been labeled or skipped. You can review and edit any trace.
        </p>

        <dl className="my-8 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line bg-surface-inset/35">
          <div className="px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Labeled</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{labeled}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Skipped</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{skipped}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-ink-faint">Total</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{total}</dd>
          </div>
        </dl>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={buttonClassName({ size: "lg" })}
          >
            Review traces
          </button>
          <Link
            to={`/p/${project}`}
            className={buttonClassName({ variant: "outline", size: "lg" })}
          >
            Back to project
          </Link>
        </div>
      </section>
    </main>
  );
}
