# 03 — Configuration System

Convention over configuration: **`tracelabel serve traces.jsonl` must work with zero config**,
yielding a trace-or-turn task with the pass/fail + reasoning default. YAML exists to override.

## 1. Full YAML surface (v1)

```yaml
# config.yaml — every key optional
data: traces.jsonl            # path to CTF JSONL, relative to this file
task: empathy                 # task name; default derived (see §4)
level: turn                   # "turn" | "trace"; default "trace"
shuffle: true                 # default false; seeded per task, stable across resume
annotator: alice              # default: OS username
label_roles: [assistant]      # turn-level only; default [assistant, document]

fields:                       # omit entirely → pass/fail default (§3)
  - preset: pass_fail         # expands to verdict + reasoning (§5)
  - name: error_type
    label: Error type         # optional display label; default = title-cased name
    type: multi_select        # single_select | multi_select | text
    options: [hallucination, tool_misuse, formatting, refusal]
    required: false           # default false
    help: "Tag all that apply"          # optional hint shown under the field
  - name: notes
    type: text
    placeholder: "Anything else?"       # text fields only

llm:                          # only needed for `tracelabel suggest`
  model: gpt-4o-mini          # litellm model string (e.g. anthropic/claude-sonnet-4-6, ollama/llama3)
  temperature: 0              # optional, default 0
  max_tokens: 1024            # optional
  # NO api keys here, ever — litellm reads provider keys from env vars (OPENAI_API_KEY, ...)

suggest:
  instructions: >             # optional extra guidance appended to the suggestion prompt
    Judge empathy from the end user's perspective.
```

CLI flags override YAML: `--task`, `--level`, `--annotator`, `--shuffle/--no-shuffle`, `--db`.
Precedence: **CLI > YAML > built-in default.**

## 2. Pydantic models (raw layer — what the user wrote)

```python
FieldType = Literal["single_select", "multi_select", "text"]
NAME_RE = r"^[a-z][a-z0-9_]{0,63}$"          # snake_case identifiers

class FieldDef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = PydanticField(pattern=NAME_RE)
    label: str | None = None
    type: FieldType
    options: list[str] | None = None          # required for selects, forbidden for text
    required: bool = False
    placeholder: str | None = None            # text only
    help: str | None = None

    @model_validator(mode="after")
    def _rules(self):
        if self.type in ("single_select", "multi_select"):
            if not self.options or len(self.options) < 2: raise ValueError("selects need ≥2 options")
            if len(self.options) != len(set(self.options)): raise ValueError("duplicate options")
            if self.placeholder: raise ValueError("placeholder is for text fields")
        elif self.options: raise ValueError("text fields take no options")
        return self

class PresetRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset: Literal["pass_fail"]

class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")   # forbid api_key & friends by construction
    model: str
    temperature: float = 0.0
    max_tokens: int = 1024

class RawConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")   # typos in keys are hard errors with Pydantic's
    data: Path | None = None                    # excellent messages — do not soften this
    task: str | None = None
    level: Literal["turn", "trace"] = "trace"
    shuffle: bool = False
    annotator: str | None = None
    label_roles: list[str] | None = None
    fields: list[PresetRef | FieldDef] | None = None
    llm: LLMConfig | None = None
    suggest: SuggestConfig | None = None
```

## 3. The default schema (normative)

When `fields` is **absent**, the resolved fields are exactly:

```python
DEFAULT_FIELDS = [
    FieldDef(name="verdict", label="Verdict", type="single_select",
             options=["pass", "fail"], required=True),
    FieldDef(name="reasoning", label="Reasoning", type="text",
             placeholder="Why is this a pass or fail?", required=False),
]
```

**Replace, don't merge:** if the user defines `fields`, this default is fully replaced.
The `pass_fail` preset (§5) makes re-declaring it a one-liner. Defaults apply per task —
there is exactly one field list per task since level became a task property.

## 4. Resolution pass (normative pseudocode)

Runs once, immediately after Pydantic validation. **Everything downstream — renderer,
annotation writer, hasher, suggester — sees only `ResolvedTaskConfig`. Nothing downstream
knows defaults or presets exist.**

```python
@dataclass(frozen=True)
class ResolvedTaskConfig:
    name: str
    level: Literal["turn", "trace"]
    fields: list[dict]            # canonical field dicts, fully expanded
    label_roles: list[str]
    shuffle: bool
    annotator: str
    schema_hash: str
    data_path: Path
    llm: LLMConfig | None
    suggest_instructions: str | None

def resolve(raw: RawConfig, cli: CliArgs) -> ResolvedTaskConfig:
    data  = cli.data or raw.data or die("No data file given (arg or `data:` in YAML)")
    name  = cli.task or raw.task or default_task_name(data)        # e.g. "traces-2026-07-11"
    level = cli.level or raw.level
    fields = expand(raw.fields) if raw.fields is not None else DEFAULT_FIELDS
    check_unique_names(fields)                                     # duplicate names = hard error
    roles = raw.label_roles or ["assistant", "document"]
    return ResolvedTaskConfig(
        name=name, level=level,
        fields=[canonical_field_dict(f) for f in fields],          # §6
        label_roles=roles,
        shuffle=cli.shuffle if cli.shuffle is not None else raw.shuffle,
        annotator=cli.annotator or (raw.annotator or os_username()),
        schema_hash=schema_hash(fields),
        data_path=data, llm=raw.llm,
        suggest_instructions=raw.suggest.instructions if raw.suggest else None)

def default_task_name(data: Path) -> str:
    return f"{data.stem}-{date.today().isoformat()}"               # never block asking for a name
```

## 5. Preset expansion

```python
PRESETS = {"pass_fail": DEFAULT_FIELDS}

def expand(items) -> list[FieldDef]:
    out = []
    for item in items:
        out.extend(PRESETS[item.preset]) if isinstance(item, PresetRef) else out.append(item)
    return out
```

Presets expand in place, preserving order, so `[{preset: pass_fail}, my_field]` yields
`[verdict, reasoning, my_field]`.

## 6. Schema hash (normative)

```python
def canonical_field_dict(f: FieldDef) -> dict:
    d = {"name": f.name, "label": f.label or f.name.replace("_", " ").capitalize(),
         "type": f.type, "required": f.required}
    if f.options:     d["options"] = f.options          # order preserved (drives hotkey numbers)
    if f.placeholder: d["placeholder"] = f.placeholder
    if f.help:        d["help"] = f.help
    return d

def schema_hash(fields) -> str:
    return sha256_hex(json.dumps([canonical_field_dict(f) for f in fields],
                                 sort_keys=True, separators=(",", ":"), ensure_ascii=False))
```

Required property: a no-config run and a config explicitly declaring the pass/fail preset (or
its two fields verbatim) produce the **same hash** — that is what makes their labels
compatible. Field *order* is significant (list order is preserved in the JSON array;
`sort_keys` only sorts keys within each object).

## 7. Error message quality bar

Config errors must name the file, the YAML path, and show a fixed example:

```
config.yaml: fields[1].type: "multiselect" is not a valid field type.
Did you mean "multi_select"? Valid types: single_select, multi_select, text.
```

Pydantic v2's error locs give this nearly for free; the CLI layer formats them.
