import { useParams } from "react-router-dom";

// Placeholder — filled in by F2-HOME (docs/refactor-plan.md §4).
// Task list, source list, and a new-task dialog (name, level, queue scope, preset).
export default function ProjectHome() {
  const { project } = useParams<{ project: string }>();

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">Project: {project}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Placeholder screen. F2-HOME fills this in with the task list and source list.
      </p>
    </div>
  );
}
