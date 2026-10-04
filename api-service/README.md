# api-service

Express REST API: authentication, resume upload, job creation, status and result endpoints.
Publishes `resume.uploaded` to Kafka; never calls the LLM itself.

```bash
cp .env.sample .env
npm run dev     # :8000
npm test
```

Layout follows the `chai-backend` conventions — `controllers/`, `db/`, `middlewares/`,
`models/`, `routes/`, `utils/`, with `app.js`, `index.js`, `constants.js` and `envConfig.js`
at the root of `src/`. `models/` holds SQL data-access objects (this project is on Postgres,
not Mongo); every method takes `tenantId` and every query is scoped by it.

See the [root README](../README.md) for the API reference and environment variables.
