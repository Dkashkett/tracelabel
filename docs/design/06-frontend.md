# 06 — Frontend

Design principle: **a labeler's time is measured in seconds per item.** Optimize throughput
and flow state. The content is the loudest thing on screen; the UI is deliberately boring.

Stack: Vite + React 18 + TypeScript + Tailwind + shadcn/ui (vendored components, no runtime
dep) + TanStack Query (server state) + TanStack Virtual (turn list). **No Redux** — client
state is only "current position + form draft," held in a `useReducer` context.
UI prefs (auto-advance and theme) persist in `localStorage`. Dark is the default when the theme
preference is missing or invalid; an explicitly stored `light` preference is preserved. A small
head script applies that resolution before the app and stylesheet paint, preventing a light flash.

## 1. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ header: task name · level badge · progress bar 137/482 · ⚙ ?│
├───────────────────────────────────┬──────────────────────────┤
│  TracePane (~65%)                 │  AnnotationPane (sticky) │
│  virtualized turn thread          │  ┌─ target: turn #4 ────┐│
│  ┌──────────────────────────┐     │  │ Verdict              ││
│  │ user      (dimmed 40%)   │     │  │  [1 pass] [2 fail]   ││
│  ├──────────────────────────┤     │  │ Reasoning            ││
│  │ assistant (ACTIVE, ring) │◀────│  │  [textarea…]         ││
│  ├──────────────────────────┤     │  │                      ││
│  │ tool      (dimmed 40%)   │     │  │ [Enter commit ▸ next]││
│  └──────────────────────────┘     │  │ [s skip]  ●saved     ││
│                                   │  └──────────────────────┘│
├───────────────────────────────────┴──────────────────────────┤
│ TraceDrawer (collapsed initially): ●done ◐partial ○todo      │
└──────────────────────────────────────────────────────────────┘
```

Rules: **no modals, ever** (the `?` cheatsheet and drawer are overlays that never trap focus
away from content). The thing being judged and the form judging it are always visible
simultaneously. Trace-level tasks: same layout, no per-turn focus; the form targets the trace.
The trace drawer starts collapsed on every load and remains directly toggleable from its footer.

## 2. Keyboard model (primary interface; mouse is fallback)

Two modes: **NAV** (default) and **FIELD** (focus inside an input).

| Key | NAV mode | FIELD mode |
|-----|----------|------------|
| `j` / `k` | next / prev **labelable** turn (turn level) | — (types) |
| `n` / `p` | next / prev trace | — |
| `1`–`9` | select option N of the **primary select** (§2.1) | option N of *focused* select |
| `Enter` | commit + auto-advance (if valid) | textarea: newline; `Cmd/Ctrl+Enter` commits |
| `r` | focus first text field | — |
| `Tab` / `Shift+Tab` | enter FIELD mode, cycle fields | cycle fields |
| `Esc` | — | back to NAV |
| `s` | skip target + advance | — |
| `u` | jump to previous target, form pre-filled for edit | — |
| `v` (hold) | peek: un-dim all turns while held | — |
| `?` | toggle cheatsheet overlay | — |

**2.1 Primary select:** the first `required` single_select in field order, else the first
select of any kind. Digits map to its options by index (options order comes from the schema —
1=pass, 2=fail in default mode). Single_select digit = choose; multi_select digit = toggle.

**2.2 Commit & auto-advance:** commit validates required fields (inline errors if not),
`PUT /api/annotations`, then advances to the **next unaddressed target** (skipping labeled +
skipped ones), crossing trace boundaries and wrapping past the physical end when an earlier target
is still unfinished. Auto-advance is ON by default with a header toggle — some people hate it.
`u` is the escape hatch auto-advance makes necessary: mistakes *will* be committed;
last-write-wins editing is the undo.

**2.3 Save on commit, never submit-at-end.** Every commit writes immediately; the ●saved
indicator flips on mutation settle. Closing the laptop mid-session costs nothing.

## 3. Turn focus mode (turn-level tasks)

- Active turn: full contrast + 2px accent ring. All others: **dimmed to 40% opacity but still
  readable** — judging a turn requires conversational context. Hold `v` to peek (un-dim all).
- Only labelable turns (`turn.labelable`) are stops for `j`/`k`; user/tool/system turns are
  dimmed context you scroll past, which typically halves labeling volume.
- **Teleprompter scrolling:** on advance, smooth-scroll the active turn to a fixed anchor at
  **~1/3 from viewport top** (room to see what preceded it). Eyes stay put; content flows past.

```typescript
function focusTurn(idx: number, list: VirtualizerHandle) {
  list.scrollToIndex(idx, { align: "start", offset: -viewportHeight() / 3, smooth: true });
  dispatch({ type: "SET_ACTIVE_TURN", idx });
}
```

## 4. Content rendering

One `TurnCard` per top-level display group; role drives a colored left border (user=blue,
assistant=green, tool=amber, system=gray) so the eye navigates structure without reading. Color is
otherwise reserved for meaning (roles, pass/fail states); the chrome is near-monochrome.

| `content_type` | Renderer |
|---|---|
| `text` | plain text, `white-space: pre-wrap`, verbatim |
| `json` | collapsible tree viewer, **collapsed beyond depth 2 by default** (tool payloads get huge); "view raw" toggle shows the verbatim string |
| `html` | sandboxed iframe: `<iframe sandbox srcdoc={content}>` — **empty `sandbox` attr: no scripts, no same-origin, no forms, no popups.** Traces are untrusted input; this is a hard security requirement. Toggle to view source. |
| `parts` | parts rendered in sequence, each by its own type's renderer |
| `markdown` (documents only) | `react-markdown` + `remark-gfm`, styled with `@tailwindcss/typography` (`prose prose-sm dark:prose-invert`) — no `dangerouslySetInnerHTML` anywhere |

The presentation layer pairs assistant `tool_calls` with later tool turns by exact
`tool_call_id`, without mutating API data. Each call/result interaction renders as an indented
child of its assistant turn. Its compact row (disclosure indicator + function name) is collapsed
by default; opening it reveals the raw `arguments` string and the normal content renderer for the
result. Multiple interactions retain call order. Calls with missing results remain expandable and
unmatched tool-result turns remain standalone `TurnCard`s, so incomplete traces never lose data.
Nested interactions inherit their assistant row's active/dimmed context and do not add virtual
rows or click-navigation stops. Disclosure changes explicitly remeasure the containing virtual
row to avoid overlap or clipping.

Long standalone turn content clamps to `max-height: 40vh` with expand-on-click — a 400-line
payload must not push the next turn off screen by default. The turn list is virtualized (TanStack
Virtual) — a 300-turn trace must not choke the DOM.

### Documents

When `TraceDetail.document` is set (05 §2), `TracePane` renders a `DocumentPane` — a single
scroll container running the content through the same `ContentByType` dispatch as turns, plus
`markdown` — instead of the virtualized turn list. There's no per-turn focus for a document:
trace-level tasks target the whole document, same as any other trace-level task.

## 5. Suggestion prefill (see 08)

If a target has a suggestion and no annotation: form renders pre-filled from `suggestion.values`
with a visible `✦ suggested by <model>` badge; committing sends `prefill_model`. Any target
with an existing annotation renders that instead (annotations always win). Clearing the form
zeroes `prefill_model`.

## 6. State architecture

```typescript
// Server state — TanStack Query. Mutation/invalidation maps exactly onto commit-and-advance.
useSession()                    // GET /api/session, staleTime: Infinity
useQueue()                      // GET /api/queue
useTrace(traceId)               // GET /api/traces/{id}; prefetch next trace on settle
useCommit(): useMutation({
  mutationFn: putAnnotation,
  onSuccess: () => { invalidate(["trace", id], ["queue"], ["progress"]); advance(); },
})

// Client state — one reducer
interface NavState {
  traceIdx: number;             // position in queue order
  turnIdx: number | null;       // active labelable turn (turn level)
  mode: "NAV" | "FIELD";
  draft: Record<string, string | string[]>;   // form values before commit
  prefillModel: string | null;
  autoAdvance: boolean; peek: boolean;
  workflow: "labeling" | "finished" | "review";
}
```

The `AnnotationForm` renders **dynamically from `session.fields`** — a single `FieldRenderer`
switch over field types. The frontend has zero knowledge of defaults, presets, or levels'
meaning; it renders whatever resolved schema the server sends. Span tagging later = a new
`case` in this switch, not a redesign.

```tsx
function FieldRenderer({ f, value, onChange }: Props) {
  switch (f.type) {
    case "single_select": return <OptionRow options={f.options!} value={value} hotkeys onChange={onChange}/>;
    case "multi_select":  return <OptionChips options={f.options!} value={value} onChange={onChange}/>;
    case "text":          return <AutoGrowTextarea placeholder={f.placeholder} value={value} onChange={onChange}/>;
  }
}
```

## 7. Progress & drawer

Thin progress bar in the header (`labeled+skipped / total`, native units) — ambient, always
visible. TraceDrawer starts collapsed and lists queue entries with ●/◐/○/⊘ states when opened;
click to jump. Skip is explicit (`s`, recorded status) so "did I miss this or decline it?" is
always answerable.

Completion is derived only from persisted queue counts: every target must be labeled or skipped.
That includes a dataset already complete when opened. After the last successful commit or skip,
the two working panes are replaced by a finished screen while the header, progress, and collapsed
trace footer remain visible. The screen reports labeled, skipped, and total counts and has one
primary **Review traces** action, which opens the footer. Selecting any trace enters `review` mode,
restores the editable workspace, and suppresses the finished screen while reviewing. There is no
final submission button or backend workflow state; every annotation continues to save immediately.

## 8. Anti-goals

No dashboards, charts, or pass-rate summaries in this UI — that's what export + pandas is
for. No settings pages beyond the two toggles (auto-advance, theme). The UI's one job is
making the next annotation effortless.
