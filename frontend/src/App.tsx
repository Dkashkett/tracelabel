import { AnnotationPane } from "@/components/AnnotationPane";
import { CheatSheet } from "@/components/CheatSheet";
import { FinishedScreen } from "@/components/FinishedScreen";
import { Header } from "@/components/Header";
import { TraceDrawer } from "@/components/TraceDrawer";
import { TracePane } from "@/components/TracePane";
import { useKeyboard } from "@/keyboard/useKeyboard";
import { NavProvider, useController } from "@/state/NavContext";

function Workspace() {
  useKeyboard();
  const { isFinished } = useController();

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Header />
      {isFinished ? (
        <FinishedScreen />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 basis-[65%]">
            <TracePane />
          </div>
          <div className="min-w-0 basis-[35%] border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <AnnotationPane />
          </div>
        </div>
      )}
      <TraceDrawer />
      <CheatSheet />
    </div>
  );
}

export default function App() {
  return (
    <NavProvider>
      <Workspace />
    </NavProvider>
  );
}
