import { Link, useParams } from "react-router-dom";
import { useController } from "@/state/NavContext";

export function FinishedScreen() {
  const { project } = useParams<{ project: string }>();
  const { completionCounts, setDrawerOpen } = useController();
  const { labeled, skipped, total } = completionCounts;

  return (
    <main className="grid min-h-0 flex-1 place-items-center bg-bg px-6 py-10">
      <section className="w-full max-w-xl rounded-xl border border-line bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-pass/15 text-2xl text-pass">
          ✓
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dataset finished</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Every target has been labeled or skipped. You can review and edit any trace.
        </p>

        <dl className="my-7 grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
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
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg shadow-sm transition-all hover:bg-accent-strong"
          >
            Review traces
          </button>
          <Link
            to={`/p/${project}`}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-raised"
          >
            Back to project
          </Link>
        </div>
      </section>
    </main>
  );
}
