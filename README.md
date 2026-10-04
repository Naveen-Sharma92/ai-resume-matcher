# AI-Powered Job/Resume Matcher

Upload a resume (PDF/DOCX), paste a job description, get back a calibrated match score,
the skills that are evidenced, the ones that are missing, and concrete suggestions.

The point of the project is the plumbing behind that sentence: two Express microservices
talking over Kafka, a RAG pipeline on Postgres + pgvector, Gemini for embeddings and
scoring, Redis for caching and rate limiting, and the whole thing containerised and
deployable on free tiers.

```
                    ┌────────────┐
 React (Vercel) ───►│ api-service│──► S3 (raw resume)
     ▲   polls      │  Express   │──► Postgres (Supabase + pgvector)
     │              └─────┬──────┘──► Redis (rate limit)
     │                    │ publish  resume.uploaded
     │              ┌─────▼──────────────┐
     │              │   Kafka (Aiven)    │
     │              └─────┬──────────────┘
     │                    │ consume
     │              ┌─────▼────────┐
     └── results ───│worker-service│──► S3 (download)  ──► pdf-parse / mammoth
        from DB     │  consumer    │──► Redis (embedding cache)
                    │              │──► Gemini (embeddings + scoring)
                    │              │──► pgvector (store + cosine retrieval)
                    └─────┬────────┘
                          │ publish  match.completed
```

## Table of contents

- [How a match actually runs](#how-a-match-actually-runs)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Testing](#testing)
- [Deployment (free tier)](#deployment-free-tier)
- [Design decisions worth defending in an interview](#design-decisions-worth-defending-in-an-interview)
- [Deviations from the original brief](#deviations-from-the-original-brief)

## How a match actually runs

1. `POST /api/v1/matches` with the resume file and the JD text. The API hashes the file,
   uploads it to S3, writes `resumes` / `job_descriptions` / `match_results(queued)` in one
   transaction, publishes `resume.uploaded` to Kafka and returns **202** with a `matchId`.
   No LLM call happens on the request path.
2. `worker-service` consumes the event, marks the row `processing`, downloads the resume,
   extracts text (`pdf-parse` / `mammoth`), chunks resume and JD, and embeds every chunk —
   checking Redis first, keyed by `sha256(chunk)`, so duplicate uploads cost nothing.
3. Chunks go into the `embeddings` table as `vector(768)`. Retrieval runs twice: once from
   the JD centroid, once per JD chunk, then dedupes — so a single buried requirement still
   pulls in its evidence instead of being averaged away.
4. The retrieved excerpts (with their similarity scores) go into a structured Gemini prompt
   with a `responseSchema`. The reply is re-validated with zod, written to `match_results`,
   and `match.completed` is published.
5. The frontend polls `GET /api/v1/matches/:id/status` (which returns the live stage
   timeline from `match_events`) and switches to the result view when it goes terminal.

Failures are graded: a Gemini 429 is retried with backoff, a scanned image-only PDF is
failed immediately, and once the attempt budget is spent the event is parked on
`match.failed.dlq`.

## Repository layout

```
.
├── api-service/          # Express REST API  (chai-backend layout)
│   ├── src/
│   │   ├── controllers/  # user, match, resume, health
│   │   ├── db/           # pg Pool + connectDB + withTransaction
│   │   ├── kafka/        # producer, topic bootstrap, publishEvent
│   │   ├── middlewares/  # auth, multer, error, rateLimit, requestContext
│   │   ├── models/       # SQL data access, one file per resource
│   │   ├── routes/       # one router per resource
│   │   ├── utils/        # ApiError, ApiResponse, asyncHandler, logger, s3, redis, hash, tokens
│   │   ├── app.js  index.js  constants.js  envConfig.js
│   ├── public/temp/      # multer scratch space before the S3 upload
│   └── tests/            # jest unit + supertest integration
├── worker-service/       # Kafka consumer (same layout + consumers/ and services/)
│   └── src/services/     # textExtraction, embedding, rag, llm
├── shared/               # @arm/shared - Kafka topics + zod event schemas + constants
├── frontend/             # React (Vite) + Tailwind v4
├── db/migrations/        # SQL migrations (pgvector schema)
├── scripts/migrate.js    # forward-only migration runner
├── docs/                 # ARCHITECTURE.md, DEPLOYMENT.md
├── docker-compose.yml    # Postgres + Redis + Redpanda + both services
└── render.yaml           # Render blueprint for both services
```

Both services follow the `chai-backend` conventions you already know: `asyncHandler`
wrappers, `ApiError` / `ApiResponse` envelopes, `*.controller.js` / `*.routes.js` /
`*.model.js` naming, `envConfig.js` for configuration and `constants.js` for fixed values.
The one deliberate difference: `models/` holds SQL data-access objects rather than Mongoose
schemas, because this project is on Postgres.

## Local development

Prerequisites: Docker Desktop, Node 20+ (for the frontend dev server) and a free Gemini API key. **No AWS account is needed to run locally** — the compose stack includes an S3 mock.

```bash
cp .env.sample .env                 # paste your GEMINI_API_KEY — that is the only required value
docker compose up --build           # postgres + redis + redpanda + s3 mock + migrations + api + worker

# frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Then open http://localhost:5173, register a workspace, upload a resume and paste a job
description.

The compose stack substitutes local equivalents for every managed service: the
`pgvector/pgvector` image for Supabase, `redis:7` for Upstash, Redpanda for Aiven Kafka and
`adobe/s3mock` for S3. Migrations and the demo bucket are created automatically. Gemini is the one
thing used for real, because a faked LLM would hide exactly the failures worth catching.

| Where         | URL                                                                 |
| ------------- | ------------------------------------------------------------------- |
| Frontend      | http://localhost:5173                                               |
| API           | http://localhost:8000/healthz                                       |
| Worker health | http://localhost:8080/healthz                                       |
| S3 mock       | http://localhost:9090 (bucket `resumes-dev`)                        |
| Kafka console | http://localhost:8090 (`docker compose --profile tools up console`) |

Switching to real S3 is one variable: leave `S3_ENDPOINT` empty and set real AWS credentials.
One caveat while on the mock: presigned download URLs are signed against the internal
`http://s3mock:9090` hostname, so they resolve inside the compose network rather than from your
browser. The upload and analysis flow is unaffected.

Without Docker:

```bash
npm install                                        # installs all workspaces
DATABASE_URL=postgres://... npm run migrate -- --seed
npm run dev:api        # :8000
npm run dev:worker     # :8080 (health only; the work happens on the Kafka consumer)
npm run dev:frontend   # :5173
```

Useful extras:

```bash
docker compose --profile tools up console   # Redpanda console on :8090 to watch the topics
npm test                                    # all Jest + Supertest suites
npm run format                              # prettier
```

## Environment variables

Each service ships its own `.env.sample`. The root `.env.sample` is only for docker-compose.

### api-service

| Variable                                                                                                      | Purpose                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT`, `NODE_ENV`, `LOG_LEVEL`                                                                               | Runtime basics. `LOG_LEVEL=debug` prints every SQL statement's timing.                                          |
| `CORS_ORIGIN`                                                                                                 | Comma-separated allowed origins. Set this to the Vercel URL in production.                                      |
| `DATABASE_URL`, `DATABASE_SSL`                                                                                | Supabase connection string. Use the **session pooler** URI; set SSL to `true`.                                  |
| `ACCESS_TOKEN_SECRET`, `ACCESS_TOKEN_EXPIRY`                                                                  | Short-lived access JWT (default 15m).                                                                           |
| `REFRESH_TOKEN_SECRET`, `REFRESH_TOKEN_EXPIRY`                                                                | Refresh JWT, stored on the user row and rotated on use.                                                         |
| `REDIS_URL`                                                                                                   | `rediss://default:<password>@<host>.upstash.io:6379` in production.                                             |
| `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX`                                                                 | Default bucket; routes override it (auth 10/min, upload 10/5min, polling 120/min).                              |
| `KAFKA_BROKERS`, `KAFKA_SSL`, `KAFKA_SASL_MECHANISM`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`, `KAFKA_CA_CERT_B64` | Aiven Kafka. The CA certificate is passed base64-encoded (`base64 -w0 ca.pem`).                                 |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PRESIGN_EXPIRY_SECONDS`          | Resume storage; downloads are handed out as presigned URLs.                                                     |
| `S3_ENDPOINT`                                                                                                 | Empty for real AWS S3. Set to `http://s3mock:9090` (docker-compose does this for you) to use the local S3 mock. |

### worker-service

Everything above (minus the JWT/CORS/presign settings) plus:

| Variable                                      | Purpose                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `KAFKA_GROUP_ID`                              | Consumer group. Keep it stable or the worker replays from the tail.                                                              |
| `GEMINI_API_KEY`                              | From Google AI Studio. The service refuses to boot without it.                                                                   |
| `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL` | Model ids — check [the model list](https://ai.google.dev/gemini-api/docs/models) and update; Google retires these on a schedule. |
| `GEMINI_EMBEDDING_DIM`                        | Must equal the `vector(...)` width in the migration (768).                                                                       |
| `GEMINI_MAX_RETRIES`, `GEMINI_TIMEOUT_MS`     | Backoff behaviour for 429/503 from the free tier.                                                                                |
| `EMBEDDING_CACHE_TTL_SECONDS`                 | How long a chunk embedding stays in Redis (default 30 days).                                                                     |
| `MAX_ATTEMPTS`                                | Attempts before a match is marked failed and parked on the DLQ.                                                                  |
| `MAX_RESUME_CHARS`                            | Hard cap on extracted text, to protect the token budget.                                                                         |

### frontend

| Variable            | Purpose                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `VITE_API_BASE_URL` | Empty locally (the Vite dev proxy handles `/api`), the Render API URL in production. |

## API reference

All routes are under `/api/v1`. Authenticated routes take `Authorization: Bearer <token>`
(cookies also work). Every response uses the `ApiResponse` / `ApiError` envelope.

| Method | Route                   | Description                                                                                                           |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/users/register`       | Creates a workspace (tenant) + owner, or joins an existing workspace by slug.                                         |
| `POST` | `/users/login`          | Returns access + refresh tokens.                                                                                      |
| `POST` | `/users/refresh-token`  | Rotates the token pair.                                                                                               |
| `POST` | `/users/logout`         | Clears the stored refresh token.                                                                                      |
| `GET`  | `/users/current-user`   | The caller.                                                                                                           |
| `POST` | `/matches`              | `multipart/form-data`: `resume` file + `jobDescription` text (+ `title`, `company`). Returns **202** and a `matchId`. |
| `GET`  | `/matches`              | Paginated history for the caller.                                                                                     |
| `GET`  | `/matches/:id`          | The full analysis, or `ready:false` while it is still running.                                                        |
| `GET`  | `/matches/:id/status`   | Cheap polling endpoint: status, `isTerminal`, and the stage timeline.                                                 |
| `GET`  | `/resumes`              | The caller's uploads.                                                                                                 |
| `GET`  | `/resumes/:id/download` | Short-lived presigned S3 URL.                                                                                         |
| `GET`  | `/healthz`              | Liveness (no dependencies).                                                                                           |
| `GET`  | `/api/v1/health/ready`  | Readiness: pings Postgres and Redis.                                                                                  |

Example:

```bash
TOKEN=$(curl -s -X POST localhost:8000/api/v1/users/login \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"Password123!","tenantSlug":"demo"}' \
  | jq -r .data.accessToken)

MATCH=$(curl -s -X POST localhost:8000/api/v1/matches \
  -H "Authorization: Bearer $TOKEN" \
  -F resume=@resume.pdf \
  -F "jobDescription=$(cat jd.txt)" \
  -F title='Backend SDE-1' | jq -r .data.matchId)

curl -s "localhost:8000/api/v1/matches/$MATCH/status" -H "Authorization: Bearer $TOKEN" | jq
```

## Data model

`db/migrations/001_init.sql` creates:

| Table              | Notes                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `tenants`          | The isolation boundary. Every other table carries `tenant_id`.                                                  |
| `users`            | bcrypt hash, role (`owner`/`admin`/`member`), stored refresh token. Unique per `(tenant_id, email)`.            |
| `resumes`          | S3 key, `content_hash` (sha256 of the bytes), cached `parsed_text`.                                             |
| `job_descriptions` | Raw text + normalised `content_hash`.                                                                           |
| `match_results`    | The job: status, score, `matched_skills` / `missing_skills` / `suggestions` as JSONB, model, latency, attempts. |
| `match_events`     | Append-only stage timeline; this is what the polling UI renders.                                                |
| `embeddings`       | One row per chunk, `vector(768)`, HNSW index with `vector_cosine_ops`.                                          |

Every query in both services is scoped by `tenant_id`, and the tenant always comes from the
JWT — never from a request body.

## Testing

```bash
npm test                              # both services
npm test --workspace api-service      # supertest + unit
npm test --workspace worker-service   # pipeline + unit
```

53 tests, no infrastructure required: Postgres, Kafka, S3 and Redis are mocked at the module
boundary, so CI runs them in seconds. The API suite drives the real router, multer pipeline,
auth middleware, validation and error envelope; the worker suite drives the real
orchestration and asserts the retry/DLQ policy.

## Deployment (free tier)

Step-by-step instructions — Supabase, Aiven, Upstash, AWS S3, Render and Vercel — are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The short version:

| Piece               | Service                     | Free tier reality                                                                                                       |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Frontend            | Vercel                      | Generous; nothing to watch out for.                                                                                     |
| `api-service`       | Render web service (Docker) | Spins down after 15 min idle; first request after that takes ~50s.                                                      |
| `worker-service`    | Render web service (Docker) | Free tier has **no** Background Workers, so it runs as a web service with a `/healthz` endpoint and an external pinger. |
| Postgres + pgvector | Supabase                    | Pauses after 7 days of inactivity; `vector` extension is available.                                                     |
| Kafka               | Aiven                       | One free Kafka service per org: 5 topics × 2 partitions, 250 KiB/s. Powers off when idle.                               |
| Redis               | Upstash                     | 500k commands/month on the free plan; we use the TLS TCP endpoint, not the REST API.                                    |
| Resume storage      | AWS S3                      | 5 GB for 12 months, then a few cents a month at this volume.                                                            |
| LLM                 | Gemini                      | Free tier rate limits are per minute and per day — the Redis cache exists partly to stay inside them.                   |

## Design decisions worth defending in an interview

- **Kafka rather than a direct call.** The upload path never waits on Gemini. A 20-second
  LLM call behind a synchronous HTTP request would tie up a connection, time out behind
  Render's proxy, and lose the job on restart. With an event on a topic, a worker crash just
  means the message is redelivered.
- **At-least-once, so everything is idempotent.** Kafka can deliver a message twice, so the
  pipeline is written to tolerate it: parsed text is reused, the embeddings insert is
  `ON CONFLICT DO NOTHING`, and the match row is driven by status rather than counted.
- **Graded failure handling.** Transient (Gemini 429/503) → retry with backoff. Permanent
  (scanned PDF, unsupported type, deleted row) → fail immediately, because a retry cannot
  change the outcome. Budget exhausted → mark failed, publish `match.completed(failed)` so
  the UI stops spinning, and park the event on a DLQ topic.
- **Caching keyed by content, not by id.** `sha256(chunk)` means the same paragraph embeds
  once across every user in the workspace, which is what keeps the project inside the Gemini
  free tier. Model id and dimension are part of the cache key, so changing either cannot mix
  incompatible vectors into one index.
- **Two-pass retrieval.** Centroid retrieval alone dilutes a single hard requirement in a
  long JD; per-chunk retrieval alone over-weights boilerplate. Running both and deduping is
  measurably better on real job descriptions.
- **Similarity scores in the prompt.** Telling the model how strong each excerpt is reduces
  invented matches, and re-validating the reply with zod means a malformed response is a
  handled error rather than a corrupt row.
- **Tenant from the token.** Every SQL statement is scoped by `tenant_id`, and that id comes
  from the verified JWT. The API never accepts a tenant id from a client.
- **Structured logs with redaction.** `pino` JSON with `Authorization`, cookies and
  passwords redacted, plus an `x-request-id` that flows from the browser through the API into
  the Kafka headers and out again in the worker's logs.

## Deviations from the original brief

Three things in the original plan no longer exist as specified, and the code reflects the
substitutes:

1. **Upstash Kafka is gone.** Upstash [announced its deprecation in September 2024](https://upstash.com/blog/workflow-kafka)
   and stopped accepting new users. The replacement is **Aiven for Apache Kafka's free tier**,
   which is real Apache Kafka (so `kafkajs`, consumer groups and topic semantics are all
   unchanged) at 5 topics × 2 partitions. Local development uses Redpanda.
2. **Render has no free Background Workers.** They are a paid instance type. `worker-service`
   is therefore deployed as a free _web service_: it runs the Kafka consumer and exposes
   `/healthz` so Render will host it, and an external cron pinger keeps it from spinning down.
   `docs/DEPLOYMENT.md` also lists always-on free alternatives if you would rather not
   depend on the pinger.
3. **The named Gemini models are retired.** `gemini-1.5-flash` and `text-embedding-004` were
   both retired during 2025. Model ids are configuration (`GEMINI_CHAT_MODEL`,
   `GEMINI_EMBEDDING_MODEL`), defaulting to current flash and embedding models — check
   [the model list](https://ai.google.dev/gemini-api/docs/models) before your first run.

**S3 vs Supabase Storage:** S3 is used, as requested. Supabase Storage would save one
account and one set of credentials, and its JS client is slightly simpler than the AWS SDK —
but it is not "meaningfully simpler" here, because the upload path is a dozen lines either
way, and S3 + IAM + presigned URLs is the thing a backend JD actually asks about. The code
touches S3 in exactly two files (`api-service/src/utils/s3.js`, `worker-service/src/utils/s3.js`),
so switching later is a contained change.
