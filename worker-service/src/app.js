import express from 'express';
import healthRouter from './routes/health.routes.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';

/**
 * The worker is not an API - this Express app exists only so the service can be
 * deployed on Render's *free web service* plan (their free tier has no
 * Background Workers) and so an uptime pinger can keep it awake.
 */
const app = express();

app.disable('x-powered-by');
app.use(healthRouter);
app.get('/', (_req, res) => res.json({ service: 'worker-service', status: 'running' }));

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
export default app;
