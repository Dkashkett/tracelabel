# 06 — Frontend

**Retired.** This doc described a single-screen frontend (no router, no project/task concept —
the whole app *was* the labeling view for whatever task the server happened to be bound to) and
specced an outline navigator (`o`) that was never built.

The frontend now has a router (`frontend/src/routes/index.tsx`) with six screens — project list,
project home, import wizard, rubric editor, label view, settings — of which the label view is the
only one carried over unchanged from the pre-router app. Its keyboard model, teleprompter scroll,
activity-cascade grouping, agent coloring, and sandboxed HTML rendering are all still exactly as
good as this doc described; they're just no longer documented separately from the code. Read them
directly:

- `frontend/src/keyboard/useKeyboard.ts` — the keyboard model
- `frontend/src/state/NavContext.tsx` — session/queue/trace state, commit/skip/navigation
- `frontend/src/presentation/` — the turn-grouping/activity-cascade pipeline
- `frontend/src/components/renderers/` — content-type rendering, including the sandboxed
  `HtmlFrame.tsx` iframe (see `CLAUDE.md`'s `dangerouslySetInnerHTML` rule)

For the other five screens, their own co-located `*.test.tsx` files are the current ground truth
for what's rendered and how — there's no separate spec doc for them yet.
