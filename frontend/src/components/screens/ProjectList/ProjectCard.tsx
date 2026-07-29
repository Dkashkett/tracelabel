import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ArrowRightIcon, FolderIcon, MoreIcon, TrashIcon } from "@/components/ui/icons";
import type { ProjectSummary } from "@/api/types";

// Short, locale-formatted date — good enough for a card subtitle. There's no shared
// date helper in lib/format.ts today (it only has duration/argument-preview helpers
// for the labeling view), so this stays local rather than adding one there.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface ProjectCardProps {
  project: ProjectSummary;
  onDelete: (project: ProjectSummary) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article className="group relative min-h-52 overflow-visible rounded-2xl border border-line-strong/70 bg-surface/90 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-panel">
      <Link
        to={`/p/${project.slug}`}
        aria-label={project.name}
        className="flex h-full min-h-52 flex-col rounded-2xl p-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/20 bg-accent/[0.07] text-accent-strong">
            <FolderIcon className="h-5 w-5" />
          </span>
          <ArrowRightIcon className="mr-8 mt-2 h-4 w-4 -translate-x-1 text-ink-faint opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
        <h2 className="mt-5 truncate text-base font-semibold tracking-tight text-ink">
          {project.name}
        </h2>
        <p className="mt-1 font-mono text-[11px] text-ink-faint">Created {formatDate(project.created_at)}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <Badge variant="outline">
            {project.task_count} {project.task_count === 1 ? "task" : "tasks"}
          </Badge>
          <Badge variant="outline">
            {project.source_count} {project.source_count === 1 ? "source" : "sources"}
          </Badge>
        </div>
      </Link>
      <div
        className="absolute right-3 top-3"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
        }}
      >
        <button
          type="button"
          aria-label={`Project actions for ${project.name}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
          className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint outline-none transition-colors hover:bg-surface-overlay hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <MoreIcon className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-20 w-40 rounded-xl border border-line-strong bg-surface-overlay p-1.5 shadow-xl shadow-black/35">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-fail outline-none hover:bg-fail/10 focus-visible:bg-fail/10"
              onClick={() => {
                setMenuOpen(false);
                onDelete(project);
              }}
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Delete project
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
