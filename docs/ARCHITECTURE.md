# Architecture

## Why two services

`api-service` is latency-sensitive and stateless; `worker-service` is throughput-sensitive
and slow (one LLM call per job, 3–20 seconds). Splitting them means:

- The upload request returns in milliseconds and never holds a connection open behind
  Render's proxy waiting on Gemini.
- The worker can be restarted, redeployed or crash mid-job without losing work: the Kafka
  offset is only committed after the job is handled.
- They scale independently. Today both run one free instance; adding a second worker is a
  matter of the consumer group rebalancing partitions, with no change to the API.

## Event contracts

Topics and payload schemas live in `shared/src/events/` and are imported by both services,
so a change to an event shape cannot silently diverge between producer and consumer.

### `resume.uploaded`

Produced by api-service after S3 + the DB transaction. Key = `matchId`.

```jsonc
{
  "eventId": "uuid",
  "eventType": "resume.uploaded",
  "eventVersion": 1,
  "occurredAt": "2026-01-01T00:00:00.000Z",
  "tenantId": "uuid",
  "userId": "uuid",
  "matchId": "uuid",
  "resume": {
    "id": "uuid",
    "s3Key": "tenants/<tenantId>/resumes/<resumeId>.pdf",
    "mimeType": "application/pdf",
    "originalFilename": "resume.pdf",
    "contentHash": "<sha256>",
  },
  "jobDescription": { "id": "uuid", "contentHash": "<sha256>" },
}
```

The event carries ids and a storage key, never the resume text or the file itself: the
payload stays small, and the data stays in the systems that own it.

### `match.completed`

Produced by worker-service on success _and_ on terminal failure (`status: "failed"`), so any
consumer can tell the difference without polling.

```jsonc
{
  "eventType": "match.completed",
  "matchId": "uuid",
  "status": "completed",
  "score": 82.5,
  "matchedSkills": [{ "name": "Kafka", "evidence": "...", "confidence": 0.9 }],
  "missingSkills": [{ "name": "Kubernetes", "importance": "critical", "reason": "..." }],
  "suggestions": [{ "title": "...", "detail": "...", "priority": "high" }],
  "summary": "...",
  "model": "gemini-...-flash",
  "latencyMs": 4200,
  "error": null,
}
```

Nothing consumes it today — the frontend reads Postgres through the API — but it is the
extension point: a notification service, an analytics sink or a webhook fan-out attaches
here without touching the worker.

### `match.failed.dlq`

The original event plus `error`, `attempts` and `failedAt`. Kept so a bad batch can be
inspected and replayed rather than disappearing into a log line.

## `eventVersion`

Every event carries one. The consumer validates with zod, so an unknown shape fails loudly
at the boundary instead of halfway through the pipeline. To evolve a schema: add optional
fields at version 1; for a breaking change, bump to 2 and handle both in the consumer until
the old messages have drained.

## The RAG pipeline

```
resume text ──► chunk (1200 chars, 200 overlap, paragraph-aware)
                   │
                   ├──► sha256 per chunk ──► Redis lookup ──┐
                   │                                        │ miss
                   │                                        ▼
                   │                                Gemini embeddings
                   │                                        │
                   └──► embeddings table (vector(768), HNSW cosine) ◄┘

jd text ──► same path ──► query vectors
                   │
                   ├── centroid  ──► top-K resume chunks
                   └── per chunk ──► top-2 resume chunks each
                                   │
                                   ▼  dedupe, sort by similarity
                        prompt with excerpts + similarity scores
                                   │
                                   ▼
                        Gemini (responseSchema: JSON) ──► zod ──► match_results
```

Choices worth knowing the reasoning for:

- **Chunk size 1200 / overlap 200.** Large enough that a whole role entry or bullet list
  usually survives intact, small enough that a chunk embeds to a single topic. The overlap
  stops a skill that lands on a boundary from being weakened in both neighbours.
- **Paragraph-first splitting.** Splitting on blank lines before falling back to a hard split
  keeps chunks starting at a sentence boundary, which measurably improves retrieval over a
  naive character window.
- **Cosine distance with HNSW.** `<=>` in pgvector, and the index is built with
  `vector_cosine_ops` so the operator and the index agree. HNSW rather than IVFFlat because
  IVFFlat needs a representative training set, and a fresh portfolio database does not have
  one.
- **Retrieval, not stuffing.** Sending the whole resume would work for a two-page CV, but the
  retrieval step is what generalises, keeps the token cost flat, and gives the prompt an
  honest per-excerpt confidence signal.

## Multi-tenancy

- `tenant_id` on every business table; composite indexes lead with it.
- The tenant comes from the verified JWT (`req.tenantId`), never from the request body, and
  every model method takes it as a required argument.
- S3 keys are prefixed `tenants/<tenantId>/`, so an IAM policy can be narrowed per tenant
  later without moving any object.
- Redis keys: rate limits are keyed `tenant:user`, so one noisy tenant cannot spend another's
  budget. Embedding cache keys are intentionally _not_ tenant-scoped — they are content
  hashes, so identical text embeds once globally. That is a deliberate trade: it leaks no
  content (a hash is not reversible) and it is what keeps the project inside the free tier.

Row-level security in Postgres is the natural next step if this became a real product;
application-level scoping is the pragmatic version here, and it is enforced in exactly one
place per table (the model).

## Failure handling

| Failure                      | Behaviour                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Gemini 429 / 503             | Retried inside the client with exponential backoff + jitter.                                                                 |
| Kafka unavailable at publish | The match row is marked `failed` immediately and the API returns 503 — the user is never left polling a job nobody will run. |
| Worker crash mid-job         | Offset not committed → message redelivered → the pipeline reruns idempotently.                                               |
| Scanned / image-only PDF     | Permanent failure with a message the user can act on. Never retried.                                                         |
| Attempts exhausted           | `match_results.status = failed`, `match.completed(failed)` published, event parked on the DLQ.                               |
| Redis down                   | Rate limiter fails **open**, embedding cache falls back to computing. Availability beats a perfect quota guard.              |
| Postgres down                | The service exits non-zero at boot so the platform marks the deploy failed rather than serving a broken API.                 |

## Request tracing

`x-request-id` is accepted from the client (or generated), attached to every `pino` line in
the API, written into the Kafka message headers, and picked up by the worker's child logger.
One id follows a match from the browser to the LLM call and back.
