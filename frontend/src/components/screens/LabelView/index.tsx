import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { AnnotationPane } from "@/components/AnnotationPane";
import { CheatSheet } from "@/components/CheatSheet";
import { FinishedScreen } from "@/components/FinishedScreen";
import { Header } from "@/components/Header";
import { TraceDrawer } from "@/components/TraceDrawer";
import { TracePane } from "@/components/TracePane";
import { useKeyboard } from "@/keyboard/useKeyboard";
import { NavProvider, useController } from "@/state/NavContext";

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
  const { trace: traceParam } = useParams<{ trace?: string }>();
  const { isFinished } = useController();
  useDeepLinkToTrace(traceParam);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <Header />
      {isFinished ? (
        <FinishedScreen />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <TracePane />
          </div>
          <div className="min-w-0 basis-[400px] border-l border-line bg-surface">
            <AnnotationPane />
          </div>
        </div>
      )}
      <TraceDrawer />
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
