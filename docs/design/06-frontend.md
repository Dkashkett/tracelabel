# 06 — Frontend

Design principle: **a labeler's time is measured in seconds per item.** Optimize throughput
and flow state. The content is the loudest thing on screen; the UI is deliberately boring.

Stack: Vite + React 18 + TypeScript + Tailwind + shadcn/ui (vendored components, no runtime
dep) + TanStack Query (server state) + TanStack Virtual (turn list). **No Redux** — client
state is only "current position + form draft," held in a `useReducer` context.
The theme preference persists in `localStorage`. Dark is the default when the preference is
missing or invalid; an explicitly stored `light` preference is preserved. A small head script
applies that resolution before the app and stylesheet paint, preventing a light flash.

## 1. Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ header: task · level · 0ms 7 msg 2 tool 3 agents 1 error · progress · ⚙ ?  │
├──────────────┬───────────────────────────────────┬──────────────────────────┤
│ OutlinePane  │  TracePane (flex-1)                │  AnnotationPane (sticky) │
│ (230px, or   │  virtualized row list               │  ┌─ target: turn #4 ────┐│
│ icon strip)  │  ┌──────────────────────────┐      │  │ Verdict              ││
│ 💬 user      │  │ user      (dimmed 40%)   │      │  │  [1 pass] [2 fail]   ││
│ ● Researcher │  ├──────────────────────────┤      │  │ Reasoning            ││
│  🔧 search   │  │ assistant (ACTIVE, ring) │◀─────│  │  [textarea…]         ││
│ ↔ handoff    │  ├──────────────────────────┤      │  │                      ││
│ ● Writer     │  │ tool      (dimmed 40%)   │      │  │ [Enter commit ▸ next]││
│              │  └──────────────────────────┘      │  │ [s skip]  ●saved     ││
├──────────────┴───────────────────────────────────┴──────────────────────────┤
│ TraceDrawer (collapsed initially): ●done ◐partial ○todo                    │
└────────────────────────────────────────────────────────────────────────────┘
```

Rules: **no modals, ever** (the `?` cheatsheet and drawer are overlays that never trap focus
away from content). The thing being judged and the form judging it are always visible
simultaneously. Trace-level tasks: same layout, no per-turn focus; the form targets the trace.
The trace drawer starts collapsed on every load and remains directly toggleable from its footer.

`OutlinePane` (§4.1) only appears for conversation traces, never for document mode (2-pane,
`TracePane | AnnotationPane`, same as before). It defaults expanded for traces with real
structure and collapsed to a slim icon strip otherwise — see §4.1 for the heuristic — and is
always manually toggleable (`o`), overriding the heuristic thereafter for the whole app
(`state/prefs.ts`, same persisted-preference pattern as the theme toggle).

## 2. Keyboard model (primary interface; mouse is fallback)

Two modes: **NAV** (default) and **FIELD** (focus inside an input).

| Key | NAV mode | FIELD mode |
|-----|----------|------------|
| `j` / `k` | next / prev **labelable** turn (turn level) | — (types) |
| `n` / `p` | next / prev trace | — |
| `1`–`9` | select option N of the **primary select** (§2.1) | option N of *focused* select |
| `Enter` | commit + advance (if valid) | textarea: newline; `Cmd/Ctrl+Enter` commits |
| `r` | focus first text field | — |
| `Tab` / `Shift+Tab` | enter FIELD mode, cycle fields | cycle fields |
| `Esc` | — | back to NAV |
| `s` | skip target + advance | — |
| `u` | back through session target history, form pre-filled for edit | — |
| `v` (hold) | peek: un-dim all turns while held | — |
| `x` | expand/collapse all tool-call cards on screen | — |
| `o` | toggle the outline navigator (§4.1) | — |
| `?` | toggle cheatsheet overlay | — |

**2.1 Primary select:** the first `required` single_select in field order, else the first
select of any kind. Digits map to its options by index (options order comes from the schema —
1=pass, 2=fail in default mode). Single_select digit = choose; multi_select digit = toggle.

**2.2 Commit & advance:** commit validates required fields (inline errors if not),
`PUT /api/annotations`, then advances to the **next unaddressed target** (skipping labeled +
skipped ones), crossing trace boundaries and wrapping past the physical end when an earlier target
is still unfinished. The header's **Back** action (`u`) walks an in-memory history of targets
visited during the current browser session, including the item just committed or skipped.
Returning to a target pre-fills its saved annotation; last-write-wins editing is the undo.

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

One `TurnCard` per top-level display row; role drives a colored left border (user=blue,
assistant=green, tool=amber, system=gray, **event=violet**) so the eye navigates structure
without reading. Color is otherwise reserved for meaning (roles, pass/fail states, agent
identity, error); the chrome is near-monochrome. `TurnCard`'s header row also shows an `agent`
chip and a `duration_ms` chip when the turn carries them (CTF v2, 01 §3.2), and an `error` badge
when `status === "error"`.

| `content_type` | Renderer |
|---|---|
| `text` | plain text, `white-space: pre-wrap`, verbatim |
| `json` | collapsible tree viewer, **collapsed beyond depth 2 by default** (tool payloads get huge); "view raw" toggle shows the verbatim string |
| `html` | sandboxed iframe: `<iframe sandbox srcdoc={content}>` — **empty `sandbox` attr: no scripts, no same-origin, no forms, no popups.** Traces are untrusted input; this is a hard security requirement. Toggle to view source. |
| `parts` | parts rendered in sequence, each by its own type's renderer |
| `markdown` (documents only) | `react-markdown` + `remark-gfm`, styled with `@tailwindcss/typography` (`prose prose-sm dark:prose-invert`) — no `dangerouslySetInnerHTML` anywhere |

Tool presentation follows `session.level`, without mutating API data — the pairing logic lives
in `presentation/turnGroups.ts`, is pure and independently unit-tested, and never changes API
turn order:

- **Trace level** (`groupToolInteractions`): pairs assistant `tool_calls` with later tool turns
  by exact `tool_call_id` (earliest unmatched call with the same id wins, so malformed/partial
  traces never lose content). Each pairing becomes one `ToolCallCard` — a wrench icon, tool name,
  a one-line pretty-printed argument preview (~80 chars, `lib/format.ts::previewArguments`), a
  duration chip, and a red error badge, all derived from the *result* turn (`ToolInteraction`).
  Expanding a card shows arguments and result side by side (stacked when narrow) through the same
  `ContentByType` renderers. Matched results leave the top-level row sequence entirely (they live
  inside the card); genuinely unmatched results stay standalone rows. `x` expands/collapses every
  card on screen at once; more than two calls on one turn adds an expand-all/collapse-all
  affordance.
- **Turn level** (`rawTurnGroups`): the virtual list uses the raw `turns` array, preserving every
  protocol message — including every tool result — as its own top-level row in API order, since
  each is independently labelable. Calls still render as `ToolCallCard`s on their originating
  assistant turn, but with `showResults={false}` (no result column, since the result is its own
  row below). The active tool-calling assistant auto-expands its cards; moving away collapses
  them again.

Non-conversational structure (CTF v2 `role:"event"` rows, never labelable) gets its own row
types instead of being force-fit into `TurnCard`:

- **`EventCard`** — one line: a kind icon (retrieval 🔎 / agent 🤖 / guardrail 🛡️ / span ⚙️),
  the row's `name`, a duration chip, and an error badge; expands to `metadata`/`raw` via the
  `JsonTree` renderer.
- **`HandoffDivider`** — a full-width centered rule reading "Agent A → Agent B" for
  `kind:"handoff"` rows (label from `metadata.from`/`metadata.to`, falling back to `name`).
- **`AgentSectionHeader`** — a slim header wherever the producing `agent` changes
  (`presentation/agentSections.ts::flattenPresentation`), with a stable per-agent accent hue
  (`lib/agentColor.ts::hueForAgent`, a deterministic hash so the same name always gets the same
  color). The first *named* agent encountered is "primary" (no indent, usually the
  orchestrator/root); every other agent's rows get a subtle left inset — indent, not nesting, so
  the virtualizer stays a flat list. A trace with no `agent` field anywhere produces no headers
  and no indentation.

`presentation/agentSections.ts::flattenPresentation` turns the row groups into one flat,
typed array (`PresentationRow`: `section-header | handoff | event | turn`) that both `TracePane`
and `OutlinePane` (§4.1) render/derive from — see `state/usePresentationRows.ts`, which computes
it once so an outline node's row index always addresses the exact row the trace pane should
scroll to.

Disclosure changes explicitly remeasure the containing virtual row to avoid overlap or clipping.

Long standalone turn content clamps to `max-height: 40vh` with expand-on-click — a 400-line
payload must not push the next turn off screen by default. The turn list is virtualized (TanStack
Virtual) — a 300-turn trace must not choke the DOM.

### 4.1 Outline navigator

`OutlinePane` is a collapsible left rail, derived purely from the same flattened row list
TracePane renders (`presentation/traceOutline.ts::deriveOutline`) — never a second source of
truth. It surfaces four kinds of node, each carrying the row index to scroll to:

- **user turns** — a truncated first-line preview (`lib/format.ts`-style truncation)
- **agent sections** — collapsible; clicking toggles visibility of everything under that section
  header until the next one, without touching the underlying row list
- **tool calls** — name, a duration chip, and an error dot; turn-level mode emits a node for
  both the call (on the assistant turn) *and* the standalone result (since `rawTurnGroups` never
  pairs them — a real gap the first pass at this pane had to fix, since otherwise labelable tool
  results had no way to be reached from the outline)
- **handoffs and events** — same label/error-state logic as their `HandoffDivider`/`EventCard`
  counterparts

Clicking a node calls `scrollToRow(rowIndex)` (a ref-based callback TracePane registers with its
virtualizer, `registerRowScroller` in `NavContext` — the two components never reach into each
other's internals) and, if the underlying turn is `labelable`, also `focusTurnByIdx` so keyboard
navigation and the outline click stay in sync. The active labelable turn is highlighted in the
outline (two-way sync); error nodes render rose-tinted.

Collapsed, the rail shrinks to a ~40px icon strip that still surfaces an aggregate error-count
badge. Expanded-vs-collapsed defaults on the **heuristic** `hasRichStructure`: expanded once a
trace has 2+ named agents, any `event` row, or 8+ tool calls; collapsed otherwise. A manual `o`
toggle always overrides the heuristic from then on (persisted in `state/prefs.ts`, same pattern
as the theme preference) — the heuristic only decides the *default* for traces the user hasn't
made a choice about yet.

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
  history: Array<{
    traceIdx: number; turnIdx: number | null;
    draft: Record<string, string | string[]>; prefillModel: string | null;
  }>;
  peek: boolean;
  workflow: "labeling" | "finished" | "review";
}
```

UI-only toggles that don't participate in target history or persistence-on-commit —
`cheatOpen`, `drawerOpen`, `toolCallsExpanded`, `outlineCollapsed` — live as plain `useState` in
`NavProvider` alongside the reducer rather than inside `NavState`, since undoing "the cheatsheet
was open" makes no sense as a history entry. All of it, reducer and plain state alike, is
exposed through one `Controller` object (`state/NavContext.tsx`) that every component reads via
`useController()` — there is no prop drilling.

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
for. No settings page: the header theme toggle and the outline navigator's expand/collapse are
the only persisted preferences, and both are one-click toggles, not a settings surface. No
waterfall/flame graph (11) — duration/status chips are the timing surface. The UI's one job is
making the next annotation effortless.
