import { useController } from "@/state/NavContext";

export function FinishedScreen() {
  const { completionCounts, setDrawerOpen } = useController();
  const { labeled, skipped, total } = completionCounts;

  return (
    <main className="grid min-h-0 flex-1 place-items-center bg-slate-50 px-6 py-10 dark:bg-slate-950">
      <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          ✓
        </div>
        <h1 className="text-2xl font-semibold">Dataset finished</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Every target has been labeled or skipped. You can review and edit any trace.
        </p>

        <dl className="my-7 grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          <div className="px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-slate-400">Labeled</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{labeled}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-slate-400">Skipped</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{skipped}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-slate-400">Total</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{total}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Review traces
        </button>
      </section>
    </main>
  );
}
