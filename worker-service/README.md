# worker-service

Kafka consumer. Downloads the resume from S3, extracts text, embeds resume and job
description (Redis-cached), stores vectors in pgvector, retrieves the most relevant excerpts
and asks Gemini for a structured match analysis. Publishes `match.completed`.

```bash
cp .env.sample .env      # GEMINI_API_KEY is required
npm run dev              # consumer + health server on :8080
npm test
```

`src/services/` holds the pipeline steps (`textExtraction`, `embedding`, `rag`, `llm`);
`src/controllers/match.controller.js` orchestrates them and owns the retry/DLQ policy.
The Express app exists only to expose `/healthz` — Render's free tier has no Background
Workers, so this runs as a web service kept warm by an external pinger.

See the [root README](../README.md) and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
