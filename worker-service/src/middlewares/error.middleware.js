import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler = (req, _res, next) =>
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  const statusCode = err.statusCode ?? 500;
  if (statusCode >= 500) logger.error({ err }, 'worker http error');
  res.status(statusCode).json({ statusCode, success: false, message: err.message });
};
