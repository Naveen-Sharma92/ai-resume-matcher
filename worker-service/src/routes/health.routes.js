import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../db/index.js';
import { getRedis } from '../utils/redis.js';
import { getWorkerState } from '../workerState.js';

const router = Router();

/**
 * Render's free plan has no Background Workers, so this service runs as a free
 * *web service* and must answer HTTP. That is also what the uptime pinger hits
 * every 10 minutes to stop the instance from spinning down mid-consume.
 */
router.get('/healthz', (_req, res) => {
  const state = getWorkerState();
  res.status(state.consumerRunning ? 200 : 503).json({
    status: state.consumerRunning ? 'ok' : 'starting',
    ...state,
  });
});

router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const checks = { postgres: 'unknown', redis: 'unknown', consumer: 'unknown' };

    try {
      await query('SELECT 1');
      checks.postgres = 'ok';
    } catch (err) {
      checks.postgres = `error: ${err.message}`;
    }

    try {
      checks.redis = (await getRedis().ping()) === 'PONG' ? 'ok' : 'unexpected';
    } catch (err) {
      checks.redis = `error: ${err.message}`;
    }

    const state = getWorkerState();
    checks.consumer = state.consumerRunning ? 'ok' : 'not running';

    const healthy = Object.values(checks).every((v) => v === 'ok');
    res
      .status(healthy ? 200 : 503)
      .json({ status: healthy ? 'ready' : 'degraded', checks, ...state });
  })
);

export default router;
