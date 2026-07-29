# 04 — CLI

**Retired.** This doc described the pre-workspace CLI (`serve`/`tasks list`, `--task`/`--level`/
`--annotator`/`--shuffle`/`--all`/`--review-of`/`--labels-from`/`--yes` flags), where one server
process was bound to exactly one project/task/annotator for its whole lifetime.

The current CLI (`src/tracelabel/cli/app.py`) is a workspace/project/task launcher:

```
tracelabel [TARGET]      --port --no-browser --dir
tracelabel demo          --port --no-browser
tracelabel import FILE   --project --dir
tracelabel suggest       --project --task --dir --limit --overwrite
tracelabel export        --project --task --dir --format --out --status --joined
```

`serve` and `tasks list` are gone — task creation, rubric editing, and task listing all happen in
the browser now. See the README's [Commands](../../README.md#commands) section for the current
surface, and `src/tracelabel/cli/app.py`/`commands.py` for the implementation (exit-code mapping,
constructor-DI'd command classes) directly.
