import pino from 'pino';
import { env } from '../envConfig.js';

/**
 * Structured JSON logs. Render/Grafana Cloud can ingest these as-is; locally
 * you can pipe through `pino-pretty` (`npm run dev | npx pino-pretty`).
 *
 * Redaction matters here: resumes are personal data and tokens are secrets.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker-service', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'accessToken',
      'refreshToken',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
