// Project list screen (docs/refactor-plan.md §4 F2-PROJECTS). Cards for each
// project and a "New project" dialog.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FolderIcon, PlusIcon } from "@/components/ui/icons";
import { EmptyState, PageFrame, PageHeader } from "@/components/ui/layout";
import { useCreateProject, useDeleteProject, useProjects } from "@/api/queries/projects";
import type { ProjectSummary } from "@/api/types";
import { FirstRunWelcome } from "./FirstRunWelcome";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectCard } from "./ProjectCard";

export default function ProjectList() {
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);

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

  function handleDelete() {
    if (!pendingDelete) return;
    deleteProject.mutate(pendingDelete.slug, {
      onSuccess: () => setPendingDelete(null),
    });
  }

  const isFirstRun = !isLoading && projects?.length === 0;

  return (
    <>
      {isFirstRun ? (
        <FirstRunWelcome onCreateProject={() => setDialogOpen(true)} />
      ) : (
        <PageFrame>
          <PageHeader
            eyebrow="Local workspace"
            title="Projects"
            description={
              projects
                ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} on this machine`
                : "Your local trace-labeling workspaces"
            }
            actions={
              <Button onClick={() => setDialogOpen(true)}>
                <PlusIcon className="h-4 w-4" />
                New project
              </Button>
            }
          />

          {isLoading && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-52 animate-pulse rounded-2xl border border-line bg-surface"
                />
              ))}
            </div>
          )}

          {!isLoading && projects && projects.length > 0 && (
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.slug}
                  project={project}
                  onDelete={setPendingDelete}
                />
              ))}
            </div>
          )}
          {!isLoading && projects?.length === 0 && (
            <EmptyState
              className="mt-8"
              icon={<FolderIcon className="h-5 w-5" />}
              title="No projects yet"
              description="Create a project to collect traces, define a rubric, and start labeling."
              action={<Button onClick={() => setDialogOpen(true)}>Create project</Button>}
            />
          )}
        </PageFrame>
      )}

      {dialogOpen && (
        <NewProjectDialog
          onCancel={() => setDialogOpen(false)}
          onCreate={handleCreate}
          submitting={createProject.isPending}
        />
      )}

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete project?"
        description={
          pendingDelete
            ? `This permanently removes “${pendingDelete.name}” and its local tasks, labels, and sources.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteProject.isPending}
            >
              {deleteProject.isPending ? "Deleting…" : "Delete project"}
            </Button>
          </>
        }
      />
    </>
  );
}
