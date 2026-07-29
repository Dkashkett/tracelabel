# Producing an import file

The [README](../README.md#data-formats) shows what each supported input format looks
like. This page covers the other half: how to *get* one of those files out of the
system you're already running.

Everything here is file-based. tracelabel never calls a vendor API — you export, then
you import.

## OpenTelemetry

`--from otel`

The adapter wants an OTLP/JSON trace export whose spans carry
[GenAI semantic-convention attributes](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
The usual path is an OTel collector's
[file exporter](https://github.com/open-telemetry/opentelemetry-collector/tree/main/exporter/fileexporter)
pointed at your agent process; your SDK's own OTLP/JSON writer works too.

```yaml
# collector config.yaml — write spans to a file instead of (or alongside) a real backend
exporters:
  file:
    path: otel-spans.json
service:
  pipelines:
    traces:
      exporters: [file]
```

```bash
tracelabel otel-spans.json
```

One export can hold many traces — spans are grouped by `traceId` and ordered
depth-first by the span tree. The adapter reads `gen_ai.operation.name` and recognizes:

| Operation | Becomes |
|---|---|
| `chat` / `generate_content` / `text_completion` | conversation turns, from `gen_ai.input.messages` / `gen_ai.output.messages` (or the older span-event style) |
| `execute_tool` | a `tool_calls` entry plus a `tool` turn, with duration and error status |
| `invoke_agent` | an agent boundary; `gen_ai.agent.name` propagates onto every descendant turn |
| retrieval / embedding | non-labelable `event` rows |

`status.code == 2` marks the turn as an error. Spans that aren't any of the above
(raw `http`, `db.client`, …) are folded into trace metadata.

## Google ADK

`--from adk`

The adapter wants the **session envelope JSON**. ADK `Session` / `Event` objects are
Pydantic models, so serialize them with `model_dump()`. Illustrative — adapt to your
session service and ids:

```python
# pip install google-adk
import json

session = await session_service.get_session(app_name=APP, user_id=UID, session_id=SID)
with open("adk-sessions.jsonl", "w") as f:
    f.write(json.dumps(session.model_dump(mode="json")) + "\n")
```

```bash
tracelabel adk-sessions.jsonl
```

Required per session: `events[].author`, and `events[].content.parts[]` where a part is
`{"text": …}`, `{"function_call": {"name", "args", "id"?}}`, or
`{"function_response": {"name", "response", "id"?}}`. Top-level `appName` / `userId` /
`id` are optional and land in trace metadata. Each event's `author` becomes the turn's
agent name, so multi-agent sessions render with a per-agent chip; a
`transfer_to_agent` call becomes a handoff divider.

## Datadog LLM Observability

`--from datadog`

The adapter wants an exported JSON/JSONL of LLM-Observability spans. Pull them from
Datadog's Export API and write one span per line:

```bash
curl -s \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  "https://api.datadoghq.com/api/v2/llm-obs/v1/spans/events?filter[from]=now-1d&filter[to]=now" \
  | jq -c '.data[].attributes' > datadog-spans.jsonl

tracelabel datadog-spans.jsonl
```

Adjust the host for your Datadog site (e.g. `api.datadoghq.eu`), and the
`.data[].attributes` jq path if your export nests fields differently — the only
requirement is that each line is a span object.

Required per span: `trace_id`, `span_id`, `start_ns`, `duration`, and a `meta` object
with a `kind`. `llm` spans carry `meta.input.messages` / `meta.output.messages` and
become turns; `tool` spans become tool calls plus results; `workflow` / `agent` spans
mark agent boundaries whose `name` propagates to descendants. `error: 1` or
`meta["error.message"]` marks the turn as an error. Spans are grouped by `trace_id`
into one trace each, ordered by `start_ns`.
