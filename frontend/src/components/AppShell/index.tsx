import { Link, Outlet, useParams } from "react-router-dom";

// Persistent chrome for every screen except LabelView. LabelView keeps its own
// full-height Header (progress bar, back button, shortcuts — see
// components/screens/LabelView) instead of being wrapped in this bar, so it isn't
// mounted under this layout route; see routes/index.tsx.
export function AppShell() {
  const { project, task } = useParams<{ project?: string; task?: string }>();

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-line bg-surface/80 px-5 py-2.5 text-sm">
        <Link to="/" className="font-semibold tracking-tight">
          tracelabel
        </Link>
        {project && (
          <>
            <span className="text-ink-faint">/</span>
            <Link to={`/p/${project}`} className="text-ink-muted hover:text-ink">
              {project}
            </Link>
          </>
        )}
        {task && (
          <>
            <span className="text-ink-faint">/</span>
            <span className="text-ink-muted">{task}</span>
          </>
        )}
        <div className="flex-1" />
        <Link to="/settings" className="text-ink-muted hover:text-ink">
          Settings
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
