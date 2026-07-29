import { Link, useParams } from "react-router-dom";
import { buttonClassName } from "@/components/ui/button";
import { ArrowLeftIcon, DatabaseIcon } from "@/components/ui/icons";
import { EmptyState, PageFrame, PageHeader } from "@/components/ui/layout";

export default function DataManager() {
  const { project, task } = useParams<{ project: string; task: string }>();

  return (
    <PageFrame width="default">
      <PageHeader
        eyebrow="Planned feature"
        title="Items"
        description={
          <>
            Browse, search, and filter targets for{" "}
            <code className="font-mono text-xs text-ink">{task}</code>.
          </>
        }
      />
      <EmptyState
        className="mt-8"
        icon={<DatabaseIcon className="h-5 w-5" />}
        title="The data manager is coming next"
        description="This route is reserved for a sortable, filterable view of task targets. Labeling data remains available in the workspace today."
        action={
          <Link
            to={`/p/${project}`}
            className={buttonClassName({ variant: "outline" })}
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to project
          </Link>
        }
      />
    </PageFrame>
  );
}
