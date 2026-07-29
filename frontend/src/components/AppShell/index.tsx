import { Link, Outlet, useParams } from "react-router-dom";
import { SettingsIcon } from "@/components/ui/icons";

// Persistent chrome for every screen except LabelView. LabelView keeps its own
// full-height Header (progress bar, back button, shortcuts — see
// components/screens/LabelView) instead of being wrapped in this bar, so it isn't
// mounted under this layout route; see routes/index.tsx.
export function AppShell() {
  const { project, task } = useParams<{ project?: string; task?: string }>();

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/82 px-4 text-sm shadow-sm shadow-black/20 backdrop-blur-xl sm:px-6">
        <Link
          to="/"
          className="group inline-flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <span className="grid h-6 w-6 place-items-center rounded-md border border-accent/35 bg-accent/10 text-[11px] font-bold text-accent-strong transition-colors group-hover:border-accent/60">
            tl
          </span>
          <span>tracelabel</span>
        </Link>
        {project && (
          <>
            <span className="hidden text-line-strong sm:inline">/</span>
            <Link
              to={`/p/${project}`}
              className="hidden max-w-48 truncate rounded-sm text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 sm:inline"
            >
              {project}
            </Link>
          </>
        )}
        {task && (
          <>
            <span className="hidden text-line-strong md:inline">/</span>
            <span className="hidden max-w-52 truncate whitespace-nowrap font-mono text-xs text-ink-faint md:inline">
              {task}
            </span>
          </>
        )}
        <div className="flex-1" />
        <Link
          to="/settings"
          aria-label="Settings"
          title="Settings"
          className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted outline-none transition-colors hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
