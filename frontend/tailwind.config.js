import typography from "@tailwindcss/typography";

// Semantic palette. Components reference these named tokens (bg / surface / ink / line /
// accent / pass / fail) rather than raw Tailwind scales, so the whole app's color language
// lives in the CSS custom properties defined in src/index.css. Dark-only: `dark` class is
// applied permanently, so `rgb(var(--x) / <alpha-value>)` values are the only palette.
function withOpacity(variable) {
  return `rgb(var(${variable}) / <alpha-value>)`;
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: withOpacity("--bg"),
        surface: {
          DEFAULT: withOpacity("--surface"),
          raised: withOpacity("--surface-raised"),
          inset: withOpacity("--surface-inset"),
        },
        ink: {
          DEFAULT: withOpacity("--ink"),
          muted: withOpacity("--ink-muted"),
          faint: withOpacity("--ink-faint"),
        },
        line: {
          DEFAULT: withOpacity("--line"),
          strong: withOpacity("--line-strong"),
        },
        accent: {
          DEFAULT: withOpacity("--accent"),
          strong: withOpacity("--accent-strong"),
          fg: withOpacity("--accent-fg"),
          glow: withOpacity("--accent-glow"),
        },
        pass: withOpacity("--pass"),
        fail: withOpacity("--fail"),
        warn: withOpacity("--warn"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.24), 0 1px 3px 0 rgb(0 0 0 / 0.28)",
        focus: "0 0 0 3px rgb(var(--accent) / 0.35)",
        glow: "0 0 0 1px rgb(var(--accent) / 0.5), 0 0 24px 0 rgb(var(--accent-glow) / 0.25)",
      },
    },
  },
  plugins: [typography],
};
