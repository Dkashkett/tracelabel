import { useParams } from "react-router-dom";

// Placeholder — filled in by F2-RUBRIC (docs/refactor-plan.md §4).
// Form builder over the three field types, preset gallery, live preview through the
// real AnnotationPane/FieldRenderer, and the breaking-change confirmation dialog.
export default function RubricEditor() {
  const { project, task } = useParams<{ project: string; task: string }>();

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">
        Rubric: {project} / {task}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Placeholder screen. F2-RUBRIC fills this in with the schema form builder.
      </p>
    </div>
  );
}
