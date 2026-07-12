# Analyzing tracelabel exports with pandas

`tracelabel export` writes a stable, long-format table — one row per annotation. JSONL nests the
label `values` as an object; CSV flattens them into `value.<field>` columns. The columns are an
API: `task, trace_id, target_type, target_id, turn_index, annotator, status, prefill_model,
schema_hash, created_at, updated_at`, plus one value per field in the task's schema.

## Three-line load

```python
import pandas as pd
df = pd.read_json("empathy-annotations.jsonl", lines=True)
df.groupby("task")["values"].apply(lambda v: (pd.json_normalize(v)["verdict"] == "pass").mean())
```

`pd.json_normalize(df["values"])` expands the nested label object into one column per field; join
it back if you want the metadata columns alongside:

```python
vals = pd.json_normalize(df["values"]).add_prefix("value.")
flat = pd.concat([df.drop(columns=["values"]), vals], axis=1)
```

(If you exported CSV instead, the `value.*` columns are already flat — skip the normalize step and
read with `pd.read_csv`.)

## A recipe per field type

**`single_select`** — pass rate, and the full verdict distribution:

```python
flat["value.verdict"].value_counts(normalize=True)
flat.groupby("annotator")["value.verdict"].apply(lambda s: (s == "pass").mean())
```

**`multi_select`** — cells are lists (JSON-array strings in CSV; call `json.loads` first there).
Explode to count how often each option was chosen:

```python
flat.explode("value.failure_modes")["value.failure_modes"].value_counts()
```

**`text`** — free-text notes; treat it as a string column:

```python
flat.loc[flat["value.notes"].str.len().gt(0), ["trace_id", "value.notes"]]
```

## Filtering by status

Skipped annotations appear with empty values (unless you exported with `--status labeled`). Keep
only committed labels before computing rates:

```python
labeled = flat[flat["status"] == "labeled"]
```

## Joining back to the trace content

You usually don't have to. Export with `--joined` and each row carries the labeled turn's `role`,
`content`, and `content_type` (turn-level tasks) or the full serialized `messages` plus trace
`metadata` (trace-level tasks) — enough to slice by content without touching the source file.
