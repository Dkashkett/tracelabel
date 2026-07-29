import { Link, useParams } from "react-router-dom";
import { buttonClassName } from "@/components/ui/button";
import { ArrowLeftIcon, SparklesIcon } from "@/components/ui/icons";
import { EmptyState, PageFrame, PageHeader } from "@/components/ui/layout";

export default function Results() {
  const { project, task } = useParams<{ project: string; task: string }>();

  return (
    <PageFrame width="default">
      <PageHeader
        eyebrow="Planned feature"
        title="Results"
        description={
          <>
            Agreement and error-analysis insights for{" "}
            <code className="font-mono text-xs text-ink">{task}</code>.
          </>
        }
      />
      <EmptyState
        className="mt-8"
        icon={<SparklesIcon className="h-5 w-5" />}
        title="Results are coming next"
        description="This route will summarize judge-versus-human agreement and surface disagreements. No analysis is generated yet."
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
