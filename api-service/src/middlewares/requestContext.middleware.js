import { v4 as uuid } from 'uuid';
import pinoHttp from 'pino-http';
import { logger } from '../utils/logger.js';

/**
 * Gives every request an id (honouring an inbound x-request-id so the
 * frontend -> api -> kafka -> worker chain can be traced end to end) and logs
 * one structured line per request.
 */
export const requestContext = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || uuid();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  autoLogging: {
    ignore: (req) => req.url === '/healthz',
  },
});

export default requestContext;
