# Free-tier deployment guide

Order matters: the managed services come first because Render needs their connection
strings, and Vercel needs the Render URL.

Budget about 90 minutes the first time. Everything below is free, except S3, which is free
for 12 months and then costs cents at this volume.

---

## 1. Supabase — Postgres + pgvector

1. Create a project at [supabase.com](https://supabase.com). Pick the region closest to the
   Render region you will use (Singapore works well from India).
2. **SQL Editor → New query** and run `db/migrations/001_init.sql`. It enables `pgcrypto`
   and `vector` itself, so nothing else is needed. (Running the file through the SQL editor
   is the simplest path; `npm run migrate` does the same thing from your machine.)
3. **Project Settings → Database → Connection string → Session pooler.** Copy that URI —
   the pooler, not the direct connection: free Render instances reconnect often and the
   direct connection limit is small.
4. Replace `[YOUR-PASSWORD]` in the URI with the database password.

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
```

> Free projects pause after 7 days with no activity. Opening the dashboard resumes them.

---

## 2. Aiven — Apache Kafka

Upstash Kafka no longer exists (see the README). Aiven's free tier is real Kafka.

1. Sign up at [aiven.io](https://aiven.io), create a project, then **Create service → Apache
   Kafka** and choose the **Free** plan (one free Kafka service per organisation).
2. Wait for the service to reach _Running_, then open the **Overview** tab:
   - Service URI → `KAFKA_BROKERS` (e.g. `kafka-xxxx-myproject.a.aivencloud.com:12345`)
   - **Authentication method: SASL** — enable SASL if it is not already, then copy the user
     and password from **Users**.
   - Download `ca.pem` from the same page.
3. Base64-encode the CA certificate onto one line:

   ```bash
   base64 -w0 ca.pem      # macOS: base64 -i ca.pem | tr -d '\n'
   ```

4. Create the topics under the **Topics** tab (the free plan allows 5 topics × 2 partitions):
   `resume.uploaded`, `match.completed`, `match.failed.dlq` — 2 partitions each.
   The services also try to create them at boot, but managed clusters often block the admin
   API, so do it here.

```
KAFKA_BROKERS=kafka-xxxx-myproject.a.aivencloud.com:12345
KAFKA_SSL=true
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_USERNAME=avnadmin
KAFKA_PASSWORD=...
KAFKA_CA_CERT_B64=<one long line>
```

> The free Kafka service powers off when it sees no activity for a while. The worker holds a
> consumer connection, which counts as activity; if it has been idle for days, restart it
> from the Aiven console.

---

## 3. Upstash — Redis

1. Create a database at [upstash.com](https://upstash.com) (global or the region nearest
   Render).
2. Copy the **TLS TCP** endpoint — the `rediss://` URI, not the REST URL. `ioredis` speaks
   the wire protocol, which is what both services use.

```
REDIS_URL=rediss://default:<password>@<name>.upstash.io:6379
```

The free plan allows 500k commands per month. The embedding cache is what keeps you inside
both this and the Gemini quota, so it pays for itself.

---

## 4. AWS S3 — resume storage

1. **Create the bucket** (e.g. `ai-resume-matcher-prod`) in your region. Keep _Block all
   public access_ **on** — downloads go through presigned URLs.
2. **Create an IAM user** with programmatic access and attach this inline policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::ai-resume-matcher-prod/*"
       }
     ]
   }
   ```

3. Save the access key pair.

```
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=ai-resume-matcher-prod
S3_ENDPOINT=            # leave empty in production - it exists only for the local S3 mock
```

Optional but sensible: a lifecycle rule that expires objects under `tenants/` after 30 days,
so a portfolio project does not quietly accumulate other people's resumes.

---

## 5. Gemini — API key

1. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Check the [current model list](https://ai.google.dev/gemini-api/docs/models) and set the
   two model ids accordingly — Google retires models on a published schedule, and the
   defaults in this repo will age.

```
GEMINI_API_KEY=...
GEMINI_CHAT_MODEL=<current flash model id>
GEMINI_EMBEDDING_MODEL=<current embedding model id>
GEMINI_EMBEDDING_DIM=768
```

> If you change the embedding model or dimension, the existing vectors are no longer
> comparable: update `vector(768)` in the migration, re-run it, and clear the `embeddings`
> table (the Redis cache invalidates itself, because the model id is part of the key).

---

## 6. Render — both services

Push the repo to GitHub first. Both services build from the **repository root** as the
Docker context, because they share the `shared/` workspace.

### Option A — the blueprint

`render.yaml` in the repo root declares both services. **New → Blueprint**, point it at the
repo, then fill in every variable marked `sync: false` in the dashboard.

### Option B — by hand

**api-service**

- New → **Web Service** → your repo
- Runtime: **Docker**, Dockerfile path `./api-service/Dockerfile`, Docker context `.`
- Instance type: **Free**
- Health check path: `/healthz`
- Environment variables: everything from the api-service table in the README, plus
  `CORS_ORIGIN` set to your Vercel URL (you will come back for this after step 7).

**worker-service**

- New → **Web Service** (not Background Worker — those are paid)
- Runtime: **Docker**, Dockerfile path `./worker-service/Dockerfile`, Docker context `.`
- Instance type: **Free**
- Health check path: `/healthz`
- Environment variables: the worker table in the README, including `GEMINI_API_KEY`.

### Keeping the worker awake

Free Render services spin down after 15 minutes without an HTTP request — which for the
worker means the Kafka consumer stops. Two options:

1. **External pinger (simplest).** Create a free job at [cron-job.org](https://cron-job.org)
   that GETs `https://<worker>.onrender.com/healthz` every 10 minutes. Do the same for the
   API if you want the demo to respond instantly.
2. **Move the worker to an always-on free tier.** [Koyeb](https://koyeb.com) and
   [Northflank](https://northflank.com) both allow a small always-on container on their free
   plans, which removes the pinger entirely. The Dockerfile works unchanged; only the
   environment variables move.

Be honest about this in your README and in interviews — "the free tier has no background
workers, so I ran the consumer inside a web service and kept it warm with a cron ping" is a
perfectly good answer, and pretending the constraint does not exist is not.

---

## 7. Vercel — frontend

1. **New Project → import the repo**, set the **Root Directory** to `frontend`.
2. Framework preset: Vite. Build command `npm run build`, output `dist` (`vercel.json`
   already says this).
3. Environment variable:

   ```
   VITE_API_BASE_URL=https://<your-api>.onrender.com
   ```

4. Deploy, then go back to Render and set `CORS_ORIGIN` on api-service to the Vercel URL
   (`https://<project>.vercel.app`). Add your preview URLs too if you use them —
   `CORS_ORIGIN` accepts a comma-separated list.

---

## 8. Smoke test

```bash
API=https://<your-api>.onrender.com

curl -s $API/healthz
curl -s $API/api/v1/health/ready | jq        # postgres + redis should both be "ok"
curl -s https://<your-worker>.onrender.com/healthz | jq   # consumerRunning: true
```

Then register in the UI, upload a resume, and watch the stage timeline. If it sticks on
`queued`, the API published but nothing is consuming — check the worker logs for a Kafka
authentication error. If it sticks on `scoring`, check the worker logs for a Gemini quota
error.

---

## 9. Optional: metrics later

Logs are structured `pino` JSON, which is the hard part. When you want dashboards:

- Add [Grafana Cloud's free tier](https://grafana.com/products/cloud/) (10k series, 50 GB
  logs) and ship logs with Grafana Alloy, or
- Expose `prom-client` metrics on `/metrics` in both services (match duration, queue lag,
  cache hit rate, Gemini latency) and scrape them with Grafana Cloud's hosted Prometheus.

The two metrics actually worth graphing here are **consumer lag** (is the worker keeping up)
and **embedding cache hit rate** (is the Gemini quota safe).
