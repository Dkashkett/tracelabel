// Presentational verdict coloring. The frontend renders arbitrary field configs and
// stays data-agnostic, so this module infers *only* a visual tone from an option's
// text — it never changes what is stored. Unknown options fall back to "neutral",
// which keeps custom configs looking exactly as they did before.

export type OptionTone = "positive" | "negative" | "neutral";

const POSITIVE_TOKENS: ReadonlySet<string> = new Set([
  "pass",
  "yes",
  "correct",
  "good",
  "accept",
  "approve",
  "approved",
  "true",
]);

const NEGATIVE_TOKENS: ReadonlySet<string> = new Set([
  "fail",
  "no",
  "incorrect",
  "bad",
  "reject",
  "rejected",
  "wrong",
  "false",
]);

/** Map a select option to a visual tone. Case- and whitespace-insensitive. */
export function optionTone(option: string): OptionTone {
  const key = option.trim().toLowerCase();
  if (POSITIVE_TOKENS.has(key)) return "positive";
  if (NEGATIVE_TOKENS.has(key)) return "negative";
  return "neutral";
}

/** Classes applied to a *selected* option, by tone. Idle styling is tone-independent
 *  and owned by the component. This is the single source of truth for verdict color. */
export interface ToneSelectedClasses {
  /** the option button when selected */
  button: string;
  /** the hotkey kbd badge when its button is selected */
  kbd: string;
}

export const toneSelectedClasses: Record<OptionTone, ToneSelectedClasses> = {
  positive: {
    button: "border-pass bg-pass/10 text-pass",
    kbd: "bg-pass/15 text-pass",
  },
  negative: {
    button: "border-fail bg-fail/10 text-fail",
    kbd: "bg-fail/15 text-fail",
  },
  neutral: {
    button: "border-accent bg-accent/10 text-accent-strong",
    kbd: "bg-accent/15 text-accent-strong",
  },
};
