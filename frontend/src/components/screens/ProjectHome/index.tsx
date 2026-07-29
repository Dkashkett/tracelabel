import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import {
  ArrowRightIcon,
  DatabaseIcon,
  PlusIcon,
  SparklesIcon,
} from "@/components/ui/icons";
import {
  EmptyState,
  Notice,
  PageFrame,
  PageHeader,
  SectionCard,
  SectionHeading,
} from "@/components/ui/layout";
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
    return (
      <PageFrame>
        <div className="h-8 w-56 animate-pulse rounded bg-surface-raised" />
        <div className="mt-10 h-56 animate-pulse rounded-2xl border border-line bg-surface" />
      </PageFrame>
    );
  }
  if (isError || !project) {
    return (
      <PageFrame width="default">
        <Notice tone="danger" title="Project not found">
          This project may have been moved or deleted.
        </Notice>
      </PageFrame>
    );
  }

  const traceCount = project.sources.reduce((sum, source) => sum + source.trace_count, 0);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        description={project.notes || "Manage sources, build labeling tasks, and track progress."}
        actions={
          <>
            <Link
              to={`/p/${slug}/import`}
              className={buttonClassName({ variant: "outline" })}
            >
              <PlusIcon className="h-4 w-4" />
              Add source
            </Link>
            <Link to={`/p/${slug}/tasks/new`} className={buttonClassName()}>
              <SparklesIcon className="h-4 w-4" />
              New task
            </Link>
          </>
        }
      >
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <dd className="font-mono text-sm font-medium text-ink">{project.tasks.length}</dd>
            <dt className="text-xs text-ink-muted">{project.tasks.length === 1 ? "task" : "tasks"}</dt>
          </div>
          <div className="flex items-baseline gap-2">
            <dd className="font-mono text-sm font-medium text-ink">{project.sources.length}</dd>
            <dt className="text-xs text-ink-muted">
              {project.sources.length === 1 ? "source" : "sources"}
            </dt>
          </div>
          <div className="flex items-baseline gap-2">
            <dd className="font-mono text-sm font-medium text-ink">{traceCount}</dd>
            <dt className="text-xs text-ink-muted">{traceCount === 1 ? "trace" : "traces"}</dt>
          </div>
        </dl>
      </PageHeader>

      <section className="mt-12">
        <SectionHeading
          eyebrow="Labeling work"
          title="Tasks"
          description="Each task combines a source scope, label level, and rubric."
        />
        {project.tasks.length === 0 ? (
          <EmptyState
            className="mt-5 min-h-56"
            icon={<SparklesIcon className="h-5 w-5" />}
            title="No tasks yet"
            description="No tasks yet — create one to start labeling."
            action={
              <Link to={`/p/${slug}/tasks/new`} className={buttonClassName()}>
                Create task
              </Link>
            }
          />
        ) : (
          <ul className="mt-5 grid gap-4">
            {project.tasks.map((task) => {
              const percent = task.total > 0 ? (task.addressed / task.total) * 100 : 0;
              return (
                <li
                  key={task.name}
                  className="group relative overflow-hidden rounded-2xl border border-line-strong/70 bg-surface/90 shadow-card transition-all hover:border-accent/30 hover:shadow-panel"
                >
                  <Link
                    to={`/p/${slug}/t/${task.name}/label`}
                    aria-label={task.name}
                    className="block p-5 pr-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 sm:pr-44"
                  >
                    <div className="flex items-center gap-3">
                      <span className="truncate font-mono text-sm font-medium text-ink">
                        {task.name}
                      </span>
                      <Badge variant="outline" className="uppercase tracking-wide">
                        {task.level}
                      </Badge>
                    </div>
                    <div className="mt-5 flex items-center gap-4">
                      <Progress value={percent} />
                      <span className="shrink-0 font-mono text-xs font-medium text-ink">
                        {Math.round(percent)}%
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                      <span>{task.addressed}/{task.total} addressed</span>
                      <span className="text-line-strong">•</span>
                      <span>{sourcesLabel(task, project.sources.length)}</span>
                      <span className="text-line-strong">•</span>
                      <span>Updated {new Date(task.updated_at).toLocaleDateString()}</span>
                    </div>
                    <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-accent-strong sm:hidden">
                      Continue labeling
                      <ArrowRightIcon className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                  <div className="border-t border-line px-5 py-3 sm:absolute sm:inset-y-0 sm:right-5 sm:flex sm:items-center sm:border-0 sm:px-0 sm:py-0">
                    <div className="flex items-center gap-1">
                      <span className="mr-2 hidden items-center gap-1 text-xs font-semibold text-accent-strong opacity-0 transition-opacity group-hover:opacity-100 sm:inline-flex">
                        Label
                        <ArrowRightIcon className="h-3.5 w-3.5" />
                      </span>
                      <Link
                        to={`/p/${slug}/t/${task.name}/schema`}
                        className="rounded-lg px-2.5 py-2 text-xs font-medium text-ink-muted outline-none transition-colors hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        Rubric
                      </Link>
                      <Link
                        to={`/p/${slug}/t/${task.name}/export`}
                        className="rounded-lg px-2.5 py-2 text-xs font-medium text-ink-muted outline-none transition-colors hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        Export
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <SectionHeading
          eyebrow="Imported data"
          title="Sources"
          description="Immutable trace inputs available to this project’s tasks."
          action={
            <Link
              to={`/p/${slug}/import`}
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add source
            </Link>
          }
        />
        {project.sources.length === 0 ? (
          <EmptyState
            className="mt-5 min-h-52"
            icon={<DatabaseIcon className="h-5 w-5" />}
            title="No sources"
            description="No sources imported yet."
            action={
              <Link to={`/p/${slug}/import`} className={buttonClassName({ variant: "outline" })}>
                Import traces
              </Link>
            }
          />
        ) : (
          <SectionCard className="mt-5 overflow-hidden">
            <ul className="divide-y divide-line">
            {project.sources.map((source) => (
              <li
                key={source.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4 text-sm transition-colors hover:bg-surface-raised/45"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-inset text-ink-faint">
                  <DatabaseIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{source.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Imported {new Date(source.imported_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="uppercase tracking-wide">
                    {source.adapter}
                  </Badge>
                  <span className="font-mono text-xs text-ink-muted">
                    {source.trace_count} traces
                  </span>
                </div>
              </li>
            ))}
            </ul>
          </SectionCard>
        )}
      </section>
    </PageFrame>
  );
}
