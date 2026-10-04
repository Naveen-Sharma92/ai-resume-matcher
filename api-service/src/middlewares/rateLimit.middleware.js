import { getRedis } from '../utils/redis.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../envConfig.js';
import { logger } from '../utils/logger.js';

/**
 * Fixed-window rate limiter backed by Redis (Upstash in production).
 *
 * INCR + EXPIRE in a single pipeline = one round trip. Keyed per tenant+user
 * when authenticated, per IP otherwise, so one noisy tenant cannot spend
 * another tenant's budget - and, more importantly on a free tier, cannot burn
 * the shared Gemini quota.
 *
 * Fails open: if Redis is down the API keeps serving rather than 500-ing.
 */
export const rateLimiter = ({
  max = env.RATE_LIMIT_MAX,
  windowSeconds = env.RATE_LIMIT_WINDOW_SECONDS,
  prefix = 'rl',
} = {}) =>
  async function rateLimitMiddleware(req, res, next) {
    try {
      const identity = req.user ? `${req.user.tenant_id}:${req.user.id}` : `ip:${req.ip}`;
      const window = Math.floor(Date.now() / 1000 / windowSeconds);
      const key = `${prefix}:${identity}:${window}`;

      const redis = getRedis();
      const [[, count]] = await redis.pipeline().incr(key).expire(key, windowSeconds).exec();

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        return next(
          ApiError.tooManyRequests(`Rate limit exceeded: ${max} requests per ${windowSeconds}s`)
        );
      }
      return next();
    } catch (err) {
      logger.warn({ err: err.message }, 'rate limiter unavailable - failing open');
      return next();
    }
  };

export default rateLimiter;
