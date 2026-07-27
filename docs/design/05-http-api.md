# 05 — HTTP API

**Retired.** This doc described the pre-workspace API, where one server process was bound to
exactly one task/annotator and every route was flat (`GET /api/session`, `GET /api/queue`, `GET
/api/traces/{id}`, `PUT /api/annotations`, `GET /api/progress` — no task or project parameters,
because the server injected them from frozen startup state). It also stated the invariant "no task
CRUD" — since revoked (see `00-overview.md`).

The current API is scoped by project and task in the path, so one server serves any number of
both:

```
GET/POST   /api/projects                                   GET/PATCH /api/settings
GET/DELETE /api/projects/{p}                                GET /api/projects/{p}/sources
POST       /api/projects/{p}/imports[/preview]
GET/POST   /api/projects/{p}/tasks                          GET/PATCH /api/projects/{p}/tasks/{t}
GET/PATCH  /api/projects/{p}/tasks/{t}/schema               (409 SchemaImpactOut on a breaking change)
GET        /api/projects/{p}/tasks/{t}/session|queue|traces/{id}|progress
PUT        /api/projects/{p}/tasks/{t}/annotations
GET        /api/projects/{p}/tasks/{t}/export
GET        /api/jobs/{job_id}                                (background imports/suggestions)
```

`src/tracelabel/api/models.py` is the authoritative source for every request/response shape —
`frontend/src/api/types.ts` is hand-synced to it (see `CLAUDE.md`). `src/tracelabel/api/routes/*.py`
holds the route implementations, one module per domain.
