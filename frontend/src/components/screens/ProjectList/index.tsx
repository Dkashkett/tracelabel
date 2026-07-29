// Project list screen (docs/refactor-plan.md §4 F2-PROJECTS). Cards for each
// project and a "New project" dialog.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCreateProject, useDeleteProject, useProjects } from "@/api/queries/projects";
import { FirstRunWelcome } from "./FirstRunWelcome";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectCard } from "./ProjectCard";

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

  const isFirstRun = !isLoading && projects?.length === 0;

  return (
    <>
      {isFirstRun ? (
        <FirstRunWelcome onCreateProject={() => setDialogOpen(true)} />
      ) : (
        <div className="p-8">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-ink">Projects</h1>
            <Button onClick={() => setDialogOpen(true)}>New project</Button>
          </div>

          {isLoading && <p className="mt-8 text-sm text-ink-muted">Loading projects…</p>}

          {!isLoading && projects && projects.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard key={project.slug} project={project} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      )}

      {dialogOpen && (
        <NewProjectDialog
          onCancel={() => setDialogOpen(false)}
          onCreate={handleCreate}
          submitting={createProject.isPending}
        />
      )}
    </>
  );
}
