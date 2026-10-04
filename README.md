# AI-Powered Job/Resume Matcher

Upload a resume, paste a job description, and get back a calibrated match score, the
skills that are actually evidenced, the ones that are missing, and concrete suggestions
for closing the gap.

Behind that is an event-driven backend: two Express microservices communicating over
Apache Kafka, a RAG pipeline on Postgres + pgvector, Google Gemini for embeddings and
scoring, Redis for caching and rate limiting — containerised and running entirely on
free-tier infrastructure.

**Live demo:** https://ai-resume-matcher-alpha.vercel.app

> The demo runs on free-tier hosting, so the first request after a period of inactivity
> can take up to a minute while the instances wake up. Subsequent requests are fast.

---

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Database schema](#database-schema)
- [Testing](#testing)
- [Deploying your own](#deploying-your-own)
- [License](#license)

---

## What it does

- **Upload** a resume (PDF or DOCX, up to 5 MB) and paste any job description
- **Parses** the document, chunks it, and embeds both the resume and the job description
- **Retrieves** the most relevant resume sections for that specific job using vector
  similarity search, rather than sending the whole document to the model
- **Scores** the match with an LLM and returns:
  - an overall fit score out of 100
  - matched skills, each with the evidence quoted from the resume
  - missing skills, ranked by how critical they are to the role
  - prioritised, actionable suggestions for improving the resume
- **Multi-tenant**: every account belongs to a workspace, and all data is scoped to it
- **Live progress**: the UI shows each pipeline stage as the worker completes it

---

## How it works

```
                      ┌──────────────┐
  React (Vercel) ────►│ api-service  │────► S3           (store the raw resume)
      ▲    polls      │   Express    │────► Postgres     (rows + pgvector)
      │               │              │────► Redis        (rate limiting)
      │               └──────┬───────┘
      │                      │  publish: resume.uploaded
      │               ┌──────▼───────┐
      │               │    Kafka     │
      │               └──────┬───────┘
      │                      │  consume
      │               ┌──────▼───────┐
      │               │worker-service│────► S3           (fetch the resume)
      └─── results ───│   consumer   │────► Redis        (embedding cache)
          from the DB │              │────► Gemini       (embeddings + scoring)
                      │              │────► pgvector     (store + cosine search)
                      └──────┬───────┘
                             │  publish: match.completed
```

1. `POST /api/v1/matches` stores the file in S3, writes the database rows in a single
   transaction, publishes a `resume.uploaded` event and returns **202 Accepted** with a
   match id. No LLM call happens on the request path, so the upload never blocks.
2. `worker-service` consumes the event, extracts text (`pdf-parse` / `mammoth`), chunks
   resume and job description, and embeds every chunk — checking Redis first, keyed by a
   hash of the chunk's content, so repeated text costs nothing.
3. Chunks are stored as 768-dimension vectors in Postgres. Retrieval runs twice — once
   from the job description's centroid, once per individual JD chunk — then deduplicates,
   so a single buried requirement still pulls in its supporting evidence.
4. The retrieved excerpts, with their similarity scores, go into a structured Gemini
   prompt. The response is validated against a schema before being written to the database
   and published as `match.completed`.
5. The frontend polls a lightweight status endpoint that returns the live stage timeline,
   then renders the result.

Failures are handled by type: a rate-limited LLM call is retried with exponential backoff,
while an unreadable scanned PDF fails immediately because retrying cannot help. Once the
attempt budget is spent the event is parked on a dead-letter topic.

---

## Tech stack

| Layer      | Technology                                                      |
| ---------- | --------------------------------------------------------------- |
| Frontend   | React 18, Vite, Tailwind CSS v4, React Router                   |
| API        | Node.js 22, Express 4, JWT auth (access + refresh), Multer, Zod |
| Worker     | Node.js 22, KafkaJS consumer, pdf-parse, mammoth                |
| Messaging  | Apache Kafka (Redpanda locally)                                 |
| Database   | PostgreSQL 16 + pgvector (HNSW, cosine)                         |
| Cache      | Redis (ioredis)                                                 |
| AI         | Google Gemini — embeddings + structured generation              |
| Storage    | AWS S3 (presigned URLs; S3-compatible mock locally)             |
| Logging    | pino structured JSON with redaction and request ids             |
| Testing    | Jest + Supertest                                                |
| Containers | Docker, Docker Compose                                          |

---

## Project structure

```
.
├── api-service/            # REST API
│   ├── src/
│   │   ├── controllers/    # request handling, one file per resource
│   │   ├── db/             # Postgres pool, transactions
│   │   ├── kafka/          # producer and topic bootstrap
│   │   ├── middlewares/    # auth, multer, error, rate limit, request context
│   │   ├── models/         # SQL data access, one file per resource
│   │   ├── routes/         # one router per resource
│   │   ├── utils/          # ApiError, ApiResponse, asyncHandler, logger, s3, redis
│   │   ├── app.js          # express app assembly
│   │   ├── index.js        # entry point
│   │   ├── constants.js
│   │   └── envConfig.js    # env loading + validation
│   └── tests/
├── worker-service/         # Kafka consumer
│   └── src/
│       ├── consumers/      # topic subscription and message handling
│       ├── services/       # textExtraction, embedding, rag, llm
│       └── ...             # same layout as api-service
├── shared/                 # Kafka topics + event schemas shared by both services
├── frontend/               # React + Vite + Tailwind
├── db/migrations/          # SQL migrations
├── scripts/migrate.js      # migration runner
├── docs/                   # architecture and deployment guides
├── docker-compose.yml      # full local stack
└── render.yaml             # infrastructure-as-code for the backend services
```

---

## Requirements

- **Docker Desktop** — runs the whole stack locally
- **Node.js 20+** — for the frontend dev server
- **A Gemini API key** — free from [Google AI Studio](https://aistudio.google.com/apikey)

No AWS account is needed to run locally; Docker Compose includes an S3-compatible mock.

---

## Running it locally

```bash
git clone https://github.com/Naveen-Sharma92/ai-resume-matcher.git
cd ai-resume-matcher

cp .env.sample .env        # paste your GEMINI_API_KEY — the only required value
docker compose up --build  # postgres + redis + kafka + s3 mock + migrations + services
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, register a workspace, upload a resume and paste a job
description.

| Service       | URL                                                                 |
| ------------- | ------------------------------------------------------------------- |
| Frontend      | http://localhost:5173                                               |
| API           | http://localhost:8000/healthz                                       |
| Worker health | http://localhost:8080/healthz                                       |
| Kafka console | http://localhost:8090 — `docker compose --profile tools up console` |

Docker Compose substitutes a local equivalent for every managed service, runs the database
migrations and creates the storage bucket automatically. Gemini is the one dependency used
for real, because a stubbed model would hide the failures worth catching early.

### Without Docker

```bash
npm install                                           # installs all workspaces
DATABASE_URL=postgres://... npm run migrate -- --seed
npm run dev:api        # :8000
npm run dev:worker     # :8080
npm run dev:frontend   # :5173
```

You will need Postgres with pgvector, Redis and a Kafka broker reachable from your machine.

---

## Environment variables

Each service has its own `.env.sample`. The root `.env` is used by Docker Compose.

### api-service

| Variable                                                                                 | Description                                                                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PORT`, `NODE_ENV`, `LOG_LEVEL`                                                          | Runtime basics. `LOG_LEVEL=debug` logs query timings.                                                          |
| `CORS_ORIGIN`                                                                            | Allowed origin(s), comma-separated. Must match the frontend exactly.                                           |
| `DATABASE_URL`, `DATABASE_SSL`                                                           | Postgres connection. Use a pooled connection string in production.                                             |
| `ACCESS_TOKEN_SECRET`, `ACCESS_TOKEN_EXPIRY`                                             | Short-lived access JWT (default 15m).                                                                          |
| `REFRESH_TOKEN_SECRET`, `REFRESH_TOKEN_EXPIRY`                                           | Refresh JWT, stored on the user row and rotated on use.                                                        |
| `REDIS_URL`                                                                              | `redis://` locally, `rediss://` for TLS providers.                                                             |
| `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX`                                            | Default bucket; routes tighten it individually.                                                                |
| `KAFKA_BROKERS`, `KAFKA_SSL`, `KAFKA_SASL_MECHANISM`, `KAFKA_USERNAME`, `KAFKA_PASSWORD` | Broker connection.                                                                                             |
| `KAFKA_CA_CERT_B64`                                                                      | Base64 of the broker's CA certificate, if it uses a private CA.                                                |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`                  | Resume storage.                                                                                                |
| `S3_ENDPOINT`                                                                            | Leave empty for real AWS S3; set it to point at an S3-compatible mock.                                         |
| `S3_PRESIGN_EXPIRY_SECONDS`                                                              | Lifetime of download URLs (default 900).                                                                       |
| `WORKER_WAKE_URL`                                                                        | Optional. The worker's health URL, pinged after a job is queued — useful on hosting that sleeps idle services. |

### worker-service

Shares the database, Redis, Kafka and S3 variables above, plus:

| Variable                                      | Description                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `KAFKA_GROUP_ID`                              | Consumer group id. Keep it stable across deploys.                                                                           |
| `GEMINI_API_KEY`                              | Required — the service will not start without it.                                                                           |
| `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL` | Model ids. Check the [model list](https://ai.google.dev/gemini-api/docs/models), since Google retires models on a schedule. |
| `GEMINI_EMBEDDING_DIM`                        | Must match the `vector(...)` width in the migration (768).                                                                  |
| `GEMINI_MAX_RETRIES`, `GEMINI_TIMEOUT_MS`     | Backoff behaviour for rate limits.                                                                                          |
| `EMBEDDING_CACHE_TTL_SECONDS`                 | Lifetime of cached chunk embeddings (default 30 days).                                                                      |
| `MAX_ATTEMPTS`                                | Attempts before a match is failed and sent to the dead-letter topic.                                                        |
| `MAX_RESUME_CHARS`                            | Hard cap on extracted text, protecting the token budget.                                                                    |

### frontend

| Variable            | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `VITE_API_BASE_URL` | API base URL. Leave empty locally to use the Vite dev proxy. |

---

## API reference

All routes are prefixed `/api/v1`. Authenticated routes accept `Authorization: Bearer <token>`.
Every response uses a consistent envelope.

| Method | Route                   | Description                                                                                   |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| `POST` | `/users/register`       | Create a workspace and its owner, or join an existing workspace.                              |
| `POST` | `/users/login`          | Returns an access token and a refresh token.                                                  |
| `POST` | `/users/refresh-token`  | Rotates the token pair.                                                                       |
| `POST` | `/users/logout`         | Invalidates the stored refresh token.                                                         |
| `GET`  | `/users/current-user`   | The authenticated user.                                                                       |
| `POST` | `/matches`              | `multipart/form-data`: `resume` file + `jobDescription` text. Returns **202** and a match id. |
| `GET`  | `/matches`              | Paginated match history.                                                                      |
| `GET`  | `/matches/:id`          | The full analysis once ready.                                                                 |
| `GET`  | `/matches/:id/status`   | Status, terminal flag and the stage timeline — built for polling.                             |
| `GET`  | `/resumes`              | The caller's uploads.                                                                         |
| `GET`  | `/resumes/:id/download` | A short-lived presigned download URL.                                                         |
| `GET`  | `/healthz`              | Liveness, with no dependencies.                                                               |
| `GET`  | `/api/v1/health/ready`  | Readiness — verifies Postgres and Redis.                                                      |

Example:

```bash
TOKEN=$(curl -s -X POST localhost:8000/api/v1/users/login \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"Password123!","tenantSlug":"demo"}' \
  | jq -r .data.accessToken)

MATCH=$(curl -s -X POST localhost:8000/api/v1/matches \
  -H "Authorization: Bearer $TOKEN" \
  -F resume=@resume.pdf \
  -F "jobDescription=$(cat jd.txt)" | jq -r .data.matchId)

curl -s "localhost:8000/api/v1/matches/$MATCH/status" -H "Authorization: Bearer $TOKEN" | jq
```

---

## Database schema

| Table              | Purpose                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `tenants`          | Workspaces — the isolation boundary. Every other table carries `tenant_id`. |
| `users`            | Accounts: bcrypt hash, role, stored refresh token. Unique per workspace.    |
| `resumes`          | Storage key, content hash, cached extracted text.                           |
| `job_descriptions` | Raw text and a normalised content hash.                                     |
| `match_results`    | The job: status, score, matched/missing skills and suggestions as JSONB.    |
| `match_events`     | Append-only stage timeline, powering the live progress UI.                  |
| `embeddings`       | One row per chunk, `vector(768)`, HNSW index with cosine distance.          |

Every query is scoped by `tenant_id`, and the tenant always comes from the verified JWT —
never from a request body.

---

## Testing

```bash
npm test                              # both services
npm test --workspace api-service      # unit + API tests
npm test --workspace worker-service   # unit + pipeline tests
```

53 tests, no infrastructure required — Postgres, Kafka, S3 and Redis are mocked at the
module boundary, so the suite runs in seconds in CI. The API tests drive the real router,
upload pipeline, auth middleware and validation; the worker tests drive the real
orchestration and assert the retry and dead-letter policy.

---

## Deploying your own

The full walkthrough, with every account and setting, is in
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. In outline:

| Component      | Service                        | Notes                                                                     |
| -------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Database       | Supabase (Postgres + pgvector) | Run `db/migrations/001_init.sql`                                          |
| Message broker | Aiven for Apache Kafka         | Create `resume.uploaded`, `match.completed`, `match.failed.dlq`           |
| Cache          | Upstash Redis                  | Use the TLS (`rediss://`) connection string                               |
| Storage        | AWS S3                         | One bucket, one IAM user with object-level access                         |
| LLM            | Google AI Studio               | API key only                                                              |
| Backend        | Render (Docker)                | Two services, Dockerfile path per service, build context at the repo root |
| Frontend       | Vercel                         | Root directory `frontend`, set `VITE_API_BASE_URL`                        |

After the frontend is deployed, set `CORS_ORIGIN` on the API to its URL.

`render.yaml` declares both backend services, so Render can provision them from the
blueprint rather than by hand.

---

## License

MIT — see [LICENSE](LICENSE).
