import Redis from 'ioredis';
import { env } from '../envConfig.js';
import { logger } from './logger.js';

/**
 * Single shared ioredis client.
 *
 * Works unchanged against local Redis (docker compose) and Upstash - Upstash
 * exposes a TLS TCP endpoint (rediss://), so we do not need their REST SDK and
 * the same code runs in both places.
 */
let client = null;

export const getRedis = () => {
  if (client) return client;

  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

  client.on('error', (err) => logger.error({ err }, 'redis error'));
  client.on('connect', () => logger.info('redis connected'));

  return client;
};

export const closeRedis = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

export default getRedis;
