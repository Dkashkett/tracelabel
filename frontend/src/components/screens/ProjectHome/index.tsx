import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useProject } from "@/api/queries/projects";
import type { TaskSummary } from "@/api/types";

function sourcesLabel(task: TaskSummary, sourceCount: number): string {
  if (task.queue_scope.type !== "source") return "All sources";
  return `${task.queue_scope.source_ids.length} of ${sourceCount} sources`;
}

export default function ProjectHome() {
  const { project: slug } = useParams<{ project: string }>();
  const { data: project, isLoading, isError } = useProject(slug);

  if (isLoading) {
    return <div className="p-8 text-sm text-ink-muted">Loading…</div>;
  }
  if (isError || !project) {
    return <div className="p-8 text-sm text-ink-muted">Project not found.</div>;
  }

  return (
    <div className="p-8">
      <header>
        <h1 className="text-lg font-semibold text-ink">{project.name}</h1>
        {project.notes && <p className="mt-1 text-sm text-ink-muted">{project.notes}</p>}
      </header>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Tasks</h2>
          <Link to={`/p/${slug}/tasks/new`}>
            <Button>New task</Button>
          </Link>
        </div>
        {project.tasks.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No tasks yet — create one to start labeling.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {project.tasks.map((task) => {
              const percent = task.total > 0 ? (task.addressed / task.total) * 100 : 0;
              return (
                <li
                  key={task.name}
                  className="group relative rounded-lg border border-line bg-surface-raised p-4 transition-colors hover:border-line-strong"
                >
                  <Link
                    to={`/p/${slug}/t/${task.name}/label`}
                    aria-label={task.name}
                    className="block pr-24"
                  >
                    <span className="text-sm font-medium text-ink">{task.name}</span>
                    <Progress className="mt-2" value={percent} />
                    <p className="mt-1 text-xs text-ink-faint">
                      {task.addressed}/{task.total} addressed ·{" "}
                      {sourcesLabel(task, project.sources.length)} · updated{" "}
                      {new Date(task.updated_at).toLocaleDateString()}
                    </p>
                  </Link>
                  <div className="absolute right-4 top-4 flex items-center gap-3">
                    <Badge variant="outline">{task.level}</Badge>
                    <Link
                      to={`/p/${slug}/t/${task.name}/schema`}
                      className="text-xs text-ink-muted hover:text-ink"
                    >
                      Rubric
                    </Link>
                    <Link
                      to={`/p/${slug}/t/${task.name}/export`}
                      className="text-xs text-ink-muted hover:text-ink"
                    >
                      Export
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Sources</h2>
          <Link to={`/p/${slug}/import`}>
            <Button variant="outline">Add source</Button>
          </Link>
        </div>
        {project.sources.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No sources imported yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {project.sources.map((source) => (
              <li
                key={source.id}
                className="flex items-center justify-between rounded-lg border border-line bg-surface-raised p-4 text-sm"
              >
                <span className="font-medium text-ink">{source.name}</span>
                <span className="text-xs text-ink-faint">
                  {source.adapter} · {source.trace_count} traces ·{" "}
                  {new Date(source.imported_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
