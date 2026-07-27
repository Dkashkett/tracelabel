import { useParams } from "react-router-dom";

// Placeholder — filled in by F2-IMPORT (docs/refactor-plan.md §4).
// Drop zone / paste / path -> detected adapter + preview traces -> Import.
export default function ImportWizard() {
  const { project } = useParams<{ project: string }>();

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">Import into {project}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Placeholder screen. F2-IMPORT fills this in with the drop zone and preview.
      </p>
    </div>
  );
}
