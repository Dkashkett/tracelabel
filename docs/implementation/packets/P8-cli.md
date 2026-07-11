# P8 — CLI (integration verb layer)

**Phase:** 4 · **Depends on:** P2, P3, P4, P5, P6, P7 · **Unblocks:** P11

**Owned files:** `src/tracelabel/cli.py`, `tests/test_cli.py`.

## Objective

The Typer command surface that wires everything together: `serve`, `import`, `export`,
`tasks list`, `suggest`, `demo`, with exact flags, precedence, exit codes, and the
serve-orchestration order.

## Required reading

- `docs/design/04-cli.md` — **all of it; §1 flags, §2 serve order, §9 exit codes are normative**
- `01-interfaces.md` §10 (frozen decisions: TARGET-omitted behavior, `demo --no-browser`,
  serve order), plus the *signatures only* of §§4–9 (you call them; don't read their source)

## Implementation notes

- **Command surface exactly per 04 §1** — same names, flags, defaults. `import` needs
  `typer` command name aliasing (`@app.command(name="import")`, function `import_`).
  `tasks` is a sub-Typer with `list`. **There is no `--host` flag anywhere** (invariant #6;
  CLI-08 greps the surface for it).
- **`serve`** follows the 04 §2 pseudocode order exactly (frozen in `01-interfaces.md` §10).
  Build `CliArgs` from flags (`None` = not passed — use `Optional` flags so precedence
  CLI > YAML > default works; a `--shuffle/--no-shuffle` pair maps to `True/False/None`).
  `import_file(..., on_conflict="fail")` on the config's data path; print the 04 §4 summary;
  print the one-line banner (`tracelabel · task '{name}' ({level}-level) · http://127.0.0.1:{port}`);
  `webbrowser.open` only after the server is about to listen and unless `--no-browser`
  (09 §3: open after listening — use uvicorn's callback or open right before `uvicorn.run`;
  acceptable MVP simplification, note it).
- **`pick_port`:** requested (default 8377) then next 9; on any taken port print the chosen
  one; exhausted → EnvError (exit 2). Check by binding a socket to 127.0.0.1 briefly.
- **Error handling:** one top-level wrapper (`run()` in `01-interfaces.md` §10 — already
  the pyproject entry point and `__main__.py` target since P0): `TraceLabelError` →
  `str(e)` to **stderr**, exit `e.exit_code`; `KeyboardInterrupt` → release lock, exit 130
  (04 §9).
- **`export`/`suggest`/`tasks list`:** thin arg-parsing shims over P6/P7/P3 functions.
  `tasks list` renders the 04 §6 table (plain `str.ljust`, no table deps), progress in
  native units. `suggest` resolves config the same way `serve` does (TARGET or
  `./config.yaml`), prints the 08 §2 summary line.
- **`demo`:** copy `demo_data/traces.jsonl` (via `importlib.resources`) into a temp project
  dir, then run the `serve` path on it with defaults (+ `--port`, `--no-browser`
  passthrough). The temp dir persists for the session (the db lives there).
- All confirms flow through the `--yes` flag → `assume_yes` (04 §9).

## Tests

Matrix rows **CLI-01 … CLI-08** via `typer.testing.CliRunner`. Mock `uvicorn.run` and
`webbrowser.open` for serve tests (assert host="127.0.0.1"); use tmp projects; CLI-07
asserts `export --out -` writes data to stdout and messages to stderr.

## Verification

```
pytest tests/test_cli.py -q
pytest -q          # full suite — this packet integrates everything
```

## Out of scope

Any behavior already owned by P2–P7 (this packet only parses, routes, formats, and exits);
`merge`, `--host`, `--on-conflict replace` (all deliberately absent).
