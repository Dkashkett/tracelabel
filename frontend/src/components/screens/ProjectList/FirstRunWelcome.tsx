import { Button } from "@/components/ui/button";
import { ArrowRightIcon, LockIcon } from "@/components/ui/icons";

interface FirstRunWelcomeProps {
  onCreateProject: () => void;
}

const steps = [
  {
    number: "01",
    title: "Bring your traces",
    description: "Drop in JSONL, OTEL, ADK, Datadog, or plain documents.",
  },
  {
    number: "02",
    title: "Shape the rubric",
    description: "Build the exact fields your evaluation needs.",
  },
  {
    number: "03",
    title: "Label at full speed",
    description: "Use keyboard shortcuts, then export clean labels.",
  },
];

function ProductPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-[31rem] lg:ml-auto lg:mr-0"
    >
      <div className="absolute -inset-8 rounded-full bg-accent/[0.07] blur-3xl" />
      <div className="relative overflow-hidden rounded-xl border border-line-strong bg-surface-inset shadow-2xl shadow-black/30">
        <div className="flex h-10 items-center gap-1.5 border-b border-line bg-surface px-4">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink-faint/70" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink-faint/40" />
          <div className="ml-3 h-1.5 w-16 rounded-full bg-line-strong" />
          <span className="ml-auto font-mono text-[9px] text-ink-faint">12 / 48</span>
        </div>

        <div className="grid grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4 border-r border-line p-4 sm:p-5">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-widest text-ink-faint">
                  User
                </span>
              </div>
              <div className="rounded-lg rounded-tl-sm border border-line bg-surface px-3 py-2.5">
                <div className="h-1.5 w-4/5 rounded-full bg-ink-muted/45" />
                <div className="mt-2 h-1.5 w-3/5 rounded-full bg-ink-muted/25" />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-widest text-accent">
                  Assistant
                </span>
              </div>
              <div className="rounded-lg rounded-tl-sm border border-accent/20 bg-accent/[0.06] px-3 py-3">
                <div className="h-1.5 w-full rounded-full bg-ink-muted/45" />
                <div className="mt-2 h-1.5 w-11/12 rounded-full bg-ink-muted/30" />
                <div className="mt-2 h-1.5 w-2/3 rounded-full bg-ink-muted/20" />
                <div className="mt-3 flex items-center gap-1.5 rounded-md border border-line bg-surface-inset/80 px-2 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-pass" />
                  <div className="h-1 w-14 rounded-full bg-ink-faint/50" />
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="font-mono text-[9px] uppercase tracking-widest text-ink-faint">
              Response quality
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-2">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-accent bg-accent text-[9px] font-semibold text-accent-fg">
                  1
                </span>
                <span className="text-[10px] font-medium text-ink">Pass</span>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[9px] text-ink-faint">
                  2
                </span>
                <span className="text-[10px] text-ink-muted">Needs review</span>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[9px] text-ink-faint">
                  3
                </span>
                <span className="text-[10px] text-ink-muted">Fail</span>
              </div>
            </div>
            <div className="mt-5 h-px bg-line" />
            <div className="mt-4 flex items-center gap-2">
              <div className="h-7 flex-1 rounded-md bg-accent" />
              <span className="rounded border border-line px-1.5 py-1 font-mono text-[8px] text-ink-faint">
                ↵
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-4 -left-3 flex items-center gap-2 rounded-lg border border-line-strong bg-surface-raised px-3 py-2 shadow-xl shadow-black/30 sm:-left-8">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pass opacity-40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-pass" />
        </span>
        <span className="font-mono text-[9px] text-ink-muted">saved locally</span>
      </div>
    </div>
  );
}

export function FirstRunWelcome({ onCreateProject }: FirstRunWelcomeProps) {
  return (
    <main className="relative min-h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_28%,rgb(var(--accent)/0.08),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgb(var(--ink))_1px,transparent_1px),linear-gradient(90deg,rgb(var(--ink))_1px,transparent_1px)] [background-size:64px_64px]" />

      <div className="relative mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-6xl flex-col px-6 pb-10 pt-14 sm:px-10 sm:pt-20 lg:px-12 lg:pt-24">
        <section className="grid items-center gap-16 lg:grid-cols-[1fr_0.95fr] lg:gap-20">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/60 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-pass" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                Local-first trace labeling
              </span>
            </div>

            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-5xl lg:text-[3.5rem]">
              Turn your traces into <span className="text-accent">golden data.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink-muted sm:text-lg sm:leading-8">
              Import any trace, build the right rubric, and label at keyboard speed. No
              accounts, no cloud, no setup.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button type="button" size="lg" onClick={onCreateProject} className="group shadow-glow">
                Create your first project
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <LockIcon className="h-3.5 w-3.5" />
                Your data stays on this machine
              </div>
            </div>
          </div>

          <ProductPreview />
        </section>

        <section className="mt-24 border-t border-line lg:mt-32 lg:pt-16">
          <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {steps.map((step, index) => (
              <div
                key={step.number}
                className={`py-5 sm:px-6 sm:py-0 ${index === 0 ? "sm:pl-0" : ""}`}
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] text-accent">{step.number}</span>
                  <h2 className="text-sm font-medium text-ink">{step.title}</h2>
                </div>
                <p className="mt-2 pl-7 text-xs leading-5 text-ink-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
