import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { AnnotationPane } from "@/components/AnnotationPane";
import { CheatSheet } from "@/components/CheatSheet";
import { FinishedScreen } from "@/components/FinishedScreen";
import { Header } from "@/components/Header";
import { TraceDrawer } from "@/components/TraceDrawer";
import { TracePane } from "@/components/TracePane";
import { useKeyboard } from "@/keyboard/useKeyboard";
import { NavProvider, useController } from "@/state/NavContext";
import { buttonClassName } from "@/components/ui/button";
import { ArrowLeftIcon, KeyboardIcon } from "@/components/ui/icons";

// Jumps the workspace to the trace named in the :trace route param, once the queue has
// loaded. Goes through `goToTrace` — the same function the UI's own next/prev-trace
// buttons call — instead of poking at NavContext internals, so it stays in sync with
// history/back behavior for free.
function useDeepLinkToTrace(traceId: string | undefined) {
  const { queue, goToTrace } = useController();

  useEffect(() => {
    if (!traceId) return;
    const idx = queue.findIndex((entry) => entry.trace_id === traceId);
    if (idx >= 0) goToTrace(idx);
    // Re-run only when the URL's trace id changes or the queue first arrives — not on
    // every queue refetch, or normal n/p navigation would keep snapping back to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceId, queue.length]);
}

function Workspace() {
  useKeyboard();
  const { trace: traceParam, project } = useParams<{ trace?: string; project: string }>();
  const { isFinished } = useController();
  useDeepLinkToTrace(traceParam);

  return (
    <div className="h-screen overflow-hidden bg-bg text-ink">
      <div className="hidden h-full min-[960px]:flex min-[960px]:flex-col">
        <Header />
        {isFinished ? (
          <FinishedScreen />
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <TracePane />
            </div>
            <aside className="min-w-[360px] basis-[30vw] max-w-[440px] border-l border-line bg-surface/95 shadow-[-18px_0_50px_-38px_rgb(0_0_0/0.9)]">
              <AnnotationPane />
            </aside>
          </div>
        )}
        <TraceDrawer />
      </div>

      <div className="flex h-full flex-col min-[960px]:hidden">
        <header className="flex h-14 items-center border-b border-line bg-surface px-5">
          <Link to="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-md border border-accent/35 bg-accent/10 text-[11px] font-bold text-accent-strong">
              tl
            </span>
            tracelabel
          </Link>
        </header>
        <main className="grid min-h-0 flex-1 place-items-center px-6 py-10">
          <section className="w-full max-w-md text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent-strong">
              <KeyboardIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
              Labeling is optimized for desktop
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              Open this task in a window at least 960px wide to keep the trace and rubric
              visible together with full keyboard navigation.
            </p>
            <Link
              to={`/p/${project}`}
              className={buttonClassName({ variant: "outline", className: "mt-6" })}
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back to project
            </Link>
          </section>
        </main>
      </div>
      <CheatSheet />
    </div>
  );
}

// The one real screen in this wave: today's App.tsx content (NavProvider > Workspace),
// extracted so it's addressed by route params instead of being the whole app. It sits
// outside AppShell's chrome — Header above already carries progress/back/shortcuts, and
// a second top bar would just eat screen space from the labeling surface.
//
// `project`/`task` come from the URL and are threaded straight into NavProvider, which
// scopes every session/queue/trace/annotations/progress call to
// /api/projects/{project}/tasks/{task}/... (docs/refactor-plan.md §3).
export default function LabelView() {
  const { project, task } = useParams<{ project: string; task: string }>();

  useEffect(() => {
    document.title = `${task} · ${project} · tracelabel`;
  }, [project, task]);

  return (
    <NavProvider project={project as string} task={task as string}>
      <Workspace />
    </NavProvider>
  );
}
