import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { query } from '../db/index.js';
import { getRedis } from '../utils/redis.js';

const startedAt = Date.now();

/** GET /healthz - liveness. Deliberately dependency-free so Render never restarts a healthy box. */
export const liveness = (_req, res) =>
  res
    .status(200)
    .json({ status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });

/** GET /api/v1/health/ready - readiness: checks Postgres and Redis. */
export const readiness = asyncHandler(async (_req, res) => {
  const checks = { postgres: 'unknown', redis: 'unknown' };

  try {
    await query('SELECT 1');
    checks.postgres = 'ok';
  } catch (err) {
    checks.postgres = `error: ${err.message}`;
  }

  try {
    const pong = await getRedis().ping();
    checks.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
  } catch (err) {
    checks.redis = `error: ${err.message}`;
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');
  return res
    .status(healthy ? 200 : 503)
    .json(new ApiResponse(healthy ? 200 : 503, { checks }, healthy ? 'Ready' : 'Degraded'));
});
