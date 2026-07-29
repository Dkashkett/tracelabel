import * as React from "react";
import { useSettings, usePatchSettings } from "@/api/queries/settings";
import type { SettingsPatch } from "@/api/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const inputClasses =
  "rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50";

export default function Settings() {
  const { data: settings, isPending } = useSettings();
  const patchSettings = usePatchSettings();

  // Local form state, seeded from the loaded settings once they arrive. Kept as
  // plain strings for the text inputs so the annotator/model fields can be
  // cleared to "" in the UI even though the API type is `string | null`.
  const [annotator, setAnnotator] = React.useState("");
  const [defaultLlmModel, setDefaultLlmModel] = React.useState("");
  const [theme, setTheme] = React.useState<Theme>("system");
  const [showSaved, setShowSaved] = React.useState(false);

  React.useEffect(() => {
    if (!settings) return;
    // `settings.annotator` is typed `string` here, but the backend model
    // (src/tracelabel/api/models.py) actually allows `None` — this frontend
    // type is mid-flight on a contract-drift fix that hasn't landed on this
    // branch yet. `?? ""` keeps this screen safe either way.
    setAnnotator(settings.annotator ?? "");
    setDefaultLlmModel(settings.default_llm_model ?? "");
    setTheme(settings.theme);
  }, [settings]);

  function handleSave() {
    // Sending the whole form each time (rather than diffing against the
    // loaded settings) is simpler and still correct: SettingsPatch fields are
    // all optional, but there's no harm re-sending unchanged values, and it
    // avoids a second source of truth for "what changed."
    const patch: SettingsPatch = {
      annotator,
      default_llm_model: defaultLlmModel === "" ? null : defaultLlmModel,
      theme,
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
      <div className="p-8">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-ink-muted">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">Settings</h1>

      <div className="mt-6 flex max-w-md flex-col gap-6">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Annotator name</span>
          <input
            type="text"
            className={inputClasses}
            value={annotator}
            onChange={(e) => setAnnotator(e.target.value)}
            placeholder="e.g. dan"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Default LLM model</span>
          <input
            type="text"
            className={inputClasses}
            value={defaultLlmModel}
            onChange={(e) => setDefaultLlmModel(e.target.value)}
            placeholder="e.g. gpt-4o-mini"
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-ink">Theme</legend>
          <div className="flex gap-2">
            {THEMES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={theme === option}
                onClick={() => setTheme(option)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm capitalize transition-colors",
                  theme === option
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-line bg-transparent text-ink-muted hover:border-line-strong hover:bg-surface-raised",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={patchSettings.isPending}>
            {patchSettings.isPending ? "Saving…" : "Save"}
          </Button>
          {showSaved && <span className="text-sm text-ink-muted">Saved</span>}
        </div>
      </div>
    </div>
  );
}
