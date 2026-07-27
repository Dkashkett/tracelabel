import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  onDelete: (slug: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  return (
    <div className="group relative rounded-lg border border-line bg-surface-raised p-4 transition-colors hover:border-line-strong">
      <Link to={`/p/${project.slug}`} className="block">
        <h2 className="text-sm font-semibold text-ink">{project.name}</h2>
        <p className="mt-1 text-xs text-ink-faint">{formatDate(project.created_at)}</p>
        <div className="mt-3 flex gap-2">
          <Badge variant="outline">
            {project.task_count} {project.task_count === 1 ? "task" : "tasks"}
          </Badge>
          <Badge variant="outline">
            {project.source_count} {project.source_count === 1 ? "source" : "sources"}
          </Badge>
        </div>
      </Link>
      <Button
        variant="ghost"
        aria-label={`Delete ${project.name}`}
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100"
        onClick={(event) => {
          event.preventDefault();
          onDelete(project.slug);
        }}
      >
        Delete
      </Button>
    </div>
  );
}
