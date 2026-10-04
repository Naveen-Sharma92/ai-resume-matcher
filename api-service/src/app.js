import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './envConfig.js';
import { API_PREFIX } from './constants.js';
import { requestContext } from './middlewares/requestContext.middleware.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';
import { liveness } from './controllers/health.controller.js';

import userRouter from './routes/user.routes.js';
import matchRouter from './routes/match.routes.js';
import resumeRouter from './routes/resume.routes.js';
import healthRouter from './routes/health.routes.js';

const app = express();

app.set('trust proxy', 1); // Render terminates TLS in front of us - needed for req.ip

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(requestContext);

// Liveness sits outside the API prefix so uptime pingers stay dead simple.
app.get('/healthz', liveness);

// Platforms probe `/` to detect the open port; answering keeps the logs clean.
app.get('/', (_req, res) =>
  res.status(200).json({ service: 'api-service', status: 'ok', docs: `${API_PREFIX}/health/ready` })
);

app.use(`${API_PREFIX}/health`, healthRouter);
app.use(`${API_PREFIX}/users`, userRouter);
app.use(`${API_PREFIX}/matches`, matchRouter);
app.use(`${API_PREFIX}/resumes`, resumeRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
export default app;
