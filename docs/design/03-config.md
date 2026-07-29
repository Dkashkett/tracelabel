# 03 — Configuration System

**Retired.** This doc described the YAML `config.yaml`-driven task resolution
(`RawConfig`/`ConfigResolver`/presets) that the pre-workspace CLI used to build a single frozen
task at server startup. The workspace/project/task model (see `00-overview.md` and
`docs/refactor-plan.md`) replaced this as the primary way to define a task: fields are built and
edited in the browser's rubric editor and created via `POST /api/projects/{p}/tasks`
(`TaskCreate` in `src/tracelabel/api/models.py`), not a config file.

The YAML loader/resolver code (`src/tracelabel/config/`) still exists in the tree but is no
longer wired into the CLI — nothing in `src/tracelabel/cli/` imports `ConfigResolver` or
`raw_config_for_target` anymore. Treat `src/tracelabel/config/models.py`'s `FieldDef`/`TaskSpec`
and `src/tracelabel/api/models.py` as the current source of truth for what a task's field schema
looks like.
