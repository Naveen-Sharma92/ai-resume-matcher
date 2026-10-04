import multer from 'multer';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { env } from '../envConfig.js';

/** 404 handler for unmatched routes - runs before the error handler. */
export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

/**
 * Central error middleware. Every thrown error leaves through here with the
 * same JSON shape, so the frontend only ever parses one error format.
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  let error = err;

  if (error instanceof ZodError) {
    error = ApiError.badRequest(
      'Validation failed',
      error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
    );
  } else if (error instanceof multer.MulterError) {
    error = ApiError.badRequest(
      error.code === 'LIMIT_FILE_SIZE' ? 'Resume exceeds the 5 MB limit' : error.message
    );
  } else if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode ?? 500;
    error = new ApiError(statusCode, error.message || 'Internal server error', [], error.stack);
  }

  const payload = {
    statusCode: error.statusCode,
    success: false,
    message: error.message,
    errors: error.errors,
    requestId: req.id,
    ...(env.isProduction ? {} : { stack: error.stack }),
  };

  const logPayload = { err: error, requestId: req.id, path: req.originalUrl };
  if (error.statusCode >= 500) logger.error(logPayload, 'request failed');
  else logger.warn(logPayload, 'request rejected');

  res.status(error.statusCode).json(payload);
};
