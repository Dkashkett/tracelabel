import { useParams } from "react-router-dom";

// Placeholder — Phase 3 (docs/refactor-plan.md §6). Exists now only so routing
// doesn't 404; judge-vs-human agreement stats land with the Phase 3 packets.
export default function Results() {
  const { project, task } = useParams<{ project: string; task: string }>();

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">
        Results: {project} / {task}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Placeholder screen. Phase 3 fills this in with agreement/confusion stats.
      </p>
    </div>
  );
}
