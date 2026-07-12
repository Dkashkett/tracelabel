import { useEffect } from "react";
import { AnnotationPane } from "@/components/AnnotationPane";
import { CheatSheet } from "@/components/CheatSheet";
import { Header } from "@/components/Header";
import { TraceDrawer } from "@/components/TraceDrawer";
import { TracePane } from "@/components/TracePane";
import { useKeyboard } from "@/keyboard/useKeyboard";
import { NavProvider } from "@/state/NavContext";
import { applyTheme, getTheme } from "@/state/prefs";

function Workspace() {
  useKeyboard();
  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Header />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 basis-[65%]">
          <TracePane />
        </div>
        <div className="min-w-0 basis-[35%] border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <AnnotationPane />
        </div>
      </div>
      <TraceDrawer />
      <CheatSheet />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    applyTheme(getTheme());
  }, []);
  return (
    <NavProvider>
      <Workspace />
    </NavProvider>
  );
}
