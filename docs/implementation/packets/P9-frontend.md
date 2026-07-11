# P9 — Frontend SPA

**Phase:** 1–4 (independent lane; starts right after P0, integrates in P11) · **Depends on:** P0 + the 05 §2 contract only · **Unblocks:** P11

**Owned files:** `frontend/**` (everything after the P0 scaffold).

## Objective

The keyboard-fast labeling UI: two-pane layout, NAV/FIELD keyboard model, schema-driven
form, safe content rendering, teleprompter scrolling, commit-and-advance against the five
API endpoints. Runs fully against mocks until the backend exists.

## Required reading

- `docs/design/06-frontend.md` — **all of it; §1 layout, §2 keyboard table, §4 render
  table, §6 state shapes are normative**
- `docs/design/05-http-api.md` §2 (copy the TS interfaces verbatim into
  `frontend/src/api/types.ts`) and §1 (endpoints)
- `01-interfaces.md` §11 (mock/proxy decisions)

## File layout (fixed — later packets and P11 rely on nothing here, but keep it)

```
frontend/src/
├── api/            types.ts (05 §2 verbatim) · client.ts (fetch wrappers) · queries.ts (TanStack hooks per 06 §6)
├── mocks/          fixtures.ts (SessionInfo + queue + 3 traces incl. tool calls, html doc, suggestion)
├── state/          navReducer.ts (NavState per 06 §6) · NavContext.tsx · prefs.ts (localStorage: autoAdvance, theme)
├── keyboard/       useKeyboard.ts (one global listener implementing the 06 §2 table)
├── components/
│   ├── Header.tsx  TracePane.tsx  TurnCard.tsx  ToolCallCard.tsx
│   ├── AnnotationPane.tsx  FieldRenderer.tsx  OptionRow.tsx  OptionChips.tsx  AutoGrowTextarea.tsx
│   ├── TraceDrawer.tsx  CheatSheet.tsx  SavedDot.tsx
│   └── renderers/  TextContent.tsx  JsonTree.tsx  HtmlFrame.tsx  PartsContent.tsx
└── App.tsx  main.tsx
```

## Implementation notes

- **Contract discipline:** the UI renders whatever `session.fields` says — zero client
  knowledge of defaults, presets, or level semantics (CLAUDE.md). `FieldRenderer` is the
  single switch from 06 §6; new field types must be a new `case`, nothing else.
- **Keyboard (06 §2 is the spec):** one `keydown` listener; NAV vs FIELD from
  `state.mode`. Digits act on the *primary select* (06 §2.1: first required single_select
  in field order, else first select). `Enter` in NAV commits if required fields valid
  (inline errors otherwise); `Cmd/Ctrl+Enter` commits from a textarea; `Esc` → NAV;
  `s` skip; `u` previous target with form pre-filled; `v` held = peek (keyup clears);
  `?` cheatsheet. Never intercept keys while a select-free input is composing (IME check
  `e.isComposing`).
- **Commit-and-advance (06 §2.2):** `useCommit` mutation → on success invalidate
  `["trace", id]`, `["queue"]`, `["progress"]`, then advance to the next *unaddressed*
  target, crossing trace boundaries, honoring the autoAdvance toggle. Optimistically move
  focus before the mutation settles (09 §3: <100 ms to next-target paint) but the ●saved
  dot flips only on settle (06 §2.3).
- **Turn focus (06 §3):** `j`/`k` stop only on `turn.labelable`; others render dimmed to
  40% opacity, readable. Teleprompter scroll: active turn anchored ~1/3 from viewport top
  via TanStack Virtual `scrollToIndex` with offset (06 §3 snippet).
- **Rendering (06 §4 table is normative):**
  - `text`: `white-space: pre-wrap`, verbatim.
  - `json`: collapsible tree (write it — ~100 lines; no new deps), collapsed beyond depth 2,
    "view raw" toggle showing the verbatim string.
  - `html`: **`<iframe sandbox="" srcdoc={content}>` — empty sandbox attr, hard security
    requirement.** `dangerouslySetInnerHTML` must not appear anywhere in `frontend/src`
    (CI greps for it in P11).
  - `parts`: parse the stored JSON array, render each part by its own renderer.
  - Tool calls: compact card, name + collapsible raw `arguments` string. Turns clamp at
    `max-height: 40vh` with expand-on-click. Role → left-border color per 06 §4.
- **Suggestions (06 §5 / 08 §4):** target with suggestion and no annotation → form
  pre-filled + `✦ suggested by <model>` badge, `prefillModel` set; user edits keep it;
  explicit clear nulls it; existing annotations always render instead.
- **State:** TanStack Query for all server state (hooks per 06 §6, `useSession` staleTime
  Infinity, prefetch next trace on settle); one `useReducer` for `NavState` exactly as
  06 §6 defines it. No Redux, no other stores.
- **Mock mode:** `VITE_MOCK=1` makes `client.ts` resolve from `mocks/fixtures.ts` (in-memory
  annotation writes so commit/advance/undo are exercisable). Fixtures must include: a
  tool-use trace, a 300-turn trace (virtualization), an HTML document trace, one suggestion,
  one existing annotation.
- Trace-level tasks: same layout, no per-turn focus; form targets the trace; `j`/`k` inert.
- No modals ever; drawer and cheatsheet are non-focus-trapping overlays (06 §1).
- Optional but recommended: vitest for `navReducer` + `FieldRenderer` (see matrix P9 note).

## Tests

Required coverage is E2E-01 (owned by P11). Recommended vitest specs per
`02-test-matrix.md` §Frontend.

## Verification

```
cd frontend && npm run typecheck && npm run build
VITE_MOCK=1 npm run dev    # manual: j/k/1/Enter/s/u/v/? all work against fixtures
```

## Out of scope

Dashboards/charts/settings pages (06 §8), span tagging, serving/packaging of `dist/` (P11),
any backend code.
