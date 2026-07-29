import * as React from "react";
import { useSettings, usePatchSettings } from "@/api/queries/settings";
import type { SettingsPatch } from "@/api/types";
import { Button } from "@/components/ui/button";
import { CheckIcon, LockIcon, SettingsIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Notice, PageFrame, PageHeader, SectionCard } from "@/components/ui/layout";

export default function Settings() {
  const { data: settings, isPending, isError } = useSettings();
  const patchSettings = usePatchSettings();

  // Local form state, seeded from the loaded settings once they arrive. Kept as
  // plain strings for the text inputs so the annotator/model fields can be
  // cleared to "" in the UI even though the API type is `string | null`.
  const [annotator, setAnnotator] = React.useState("");
  const [defaultLlmModel, setDefaultLlmModel] = React.useState("");
  const [showSaved, setShowSaved] = React.useState(false);

  React.useEffect(() => {
    if (!settings) return;
    // `settings.annotator` is typed `string` here, but the backend model
    // (src/tracelabel/api/models.py) actually allows `None` — this frontend
    // type is mid-flight on a contract-drift fix that hasn't landed on this
    // branch yet. `?? ""` keeps this screen safe either way.
    setAnnotator(settings.annotator ?? "");
    setDefaultLlmModel(settings.default_llm_model ?? "");
  }, [settings]);

  function handleSave() {
    // Sending the whole form each time (rather than diffing against the
    // loaded settings) is simpler and still correct: SettingsPatch fields are
    // all optional, but there's no harm re-sending unchanged values, and it
    // avoids a second source of truth for "what changed."
    const patch: SettingsPatch = {
      annotator,
      default_llm_model: defaultLlmModel === "" ? null : defaultLlmModel,
    };
    patchSettings.mutate(patch, {
      onSuccess: () => {
        setShowSaved(true);
        window.setTimeout(() => setShowSaved(false), 2000);
      },
    });
  }

  if (isPending) {
    return (
      <PageFrame width="narrow">
        <p className="sr-only">Loading settings…</p>
        <div className="h-8 w-44 animate-pulse rounded-md bg-surface-raised" />
        <div className="mt-8 h-72 animate-pulse rounded-2xl border border-line bg-surface" />
      </PageFrame>
    );
  }

  if (isError) {
    return (
      <PageFrame width="narrow">
        <Notice tone="danger" title="Settings could not be loaded">
          Refresh the page and try again.
        </Notice>
      </PageFrame>
    );
  }

  return (
    <PageFrame width="narrow">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Defaults used when you create and run local labeling tasks."
      />

      <SectionCard className="mt-8 overflow-hidden">
        <div className="flex items-start gap-3 border-b border-line px-5 py-5 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/[0.07] text-accent-strong">
            <SettingsIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">Labeling defaults</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Applied to new work while remaining editable per task.
            </p>
          </div>
        </div>

        <form
          className="space-y-6 p-5 sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <label className="block">
            <span className="text-xs font-semibold text-ink">Annotator name</span>
            <Input
              type="text"
              className="mt-2"
              value={annotator}
              onChange={(event) => {
                setAnnotator(event.target.value);
                setShowSaved(false);
              }}
              placeholder="e.g. dan"
            />
            <span className="mt-1.5 block text-xs leading-5 text-ink-faint">
              Included with every annotation so exported labels retain authorship.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-ink">Default LLM model</span>
            <Input
              type="text"
              className="mt-2 font-mono text-xs"
              value={defaultLlmModel}
              onChange={(event) => {
                setDefaultLlmModel(event.target.value);
                setShowSaved(false);
              }}
              placeholder="e.g. gpt-4o-mini"
            />
            <span className="mt-1.5 block text-xs leading-5 text-ink-faint">
              Used for optional suggestion generation when no model is specified.
            </span>
          </label>

          {patchSettings.isError && (
            <Notice tone="danger" title="Settings were not saved">
              {(patchSettings.error as Error).message}
            </Notice>
          )}

          <div className="flex items-center gap-3 border-t border-line pt-5">
            <Button type="submit" disabled={patchSettings.isPending}>
              {patchSettings.isPending ? "Saving…" : "Save settings"}
            </Button>
            {showSaved && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-pass"
              >
                <CheckIcon className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
          </div>
        </form>
      </SectionCard>

      <Notice className="mt-5" title="Local by design">
        <span className="inline-flex items-start gap-2">
          <LockIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint" />
          Settings and labeling data stay in this workspace. API keys are read from your
          environment and are never stored here.
        </span>
      </Notice>
    </PageFrame>
  );
}
