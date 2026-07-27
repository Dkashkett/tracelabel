import { useParams } from "react-router-dom";

// Placeholder — Phase 2 (docs/refactor-plan.md §6). Exists now only so routing
// doesn't 404; the filterable/sortable item table lands with the Phase 2 packets.
export default function DataManager() {
  const { project, task } = useParams<{ project: string; task: string }>();

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">
        Items: {project} / {task}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Placeholder screen. Phase 2 fills this in with the data manager table.
      </p>
    </div>
  );
}
