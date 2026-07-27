// Project list screen (docs/refactor-plan.md §4 F2-PROJECTS). Cards for each
// project, a "New project" dialog, and a "Start from demo data" button that routes
// through the normal import path instead of a special CLI code path.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCreateProject, useDeleteProject, useProjects } from "@/api/queries/projects";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectCard } from "./ProjectCard";

const DEMO_PROJECT_NAME = "Demo";

export default function ProjectList() {
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCreate(name: string, notes: string) {
    createProject.mutate(
      { name, notes: notes || undefined },
      {
        onSuccess: (project) => {
          setDialogOpen(false);
          navigate(`/p/${project.slug}`);
        },
      },
    );
  }

  function handleDelete(slug: string) {
    if (!window.confirm(`Delete project "${slug}"? This cannot be undone.`)) return;
    deleteProject.mutate(slug);
  }

  // "Start from demo data" doesn't import anything itself — it just creates a
  // project and hands off to that project's import screen (F2-IMPORT), which owns
  // the actual demo-data content and the call to useStartImport. This button's whole
  // job is: create the project, then navigate. That's why it looks so thin.
  function handleStartFromDemoData() {
    createProject.mutate(
      { name: DEMO_PROJECT_NAME },
      {
        onSuccess: (project) => navigate(`/p/${project.slug}/import`),
      },
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Projects</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleStartFromDemoData} disabled={createProject.isPending}>
            Start from demo data
          </Button>
          <Button onClick={() => setDialogOpen(true)}>New project</Button>
        </div>
      </div>

      {isLoading && <p className="mt-8 text-sm text-ink-muted">Loading projects…</p>}

      {!isLoading && projects?.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium text-ink">No projects yet</p>
          <p className="text-sm text-ink-muted">
            Create a project, or start from demo data to see tracelabel in action.
          </p>
        </div>
      )}

      {!isLoading && projects && projects.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.slug} project={project} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {dialogOpen && (
        <NewProjectDialog
          onCancel={() => setDialogOpen(false)}
          onCreate={handleCreate}
          submitting={createProject.isPending}
        />
      )}
    </div>
  );
}
