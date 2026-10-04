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
    // Queue commands issued before the handshake completes instead of failing
    // them. Without this the first command after a cold start always throws
    // "Stream isn't writeable", because the socket is still connecting.
    enableOfflineQueue: true,
    lazyConnect: false,
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

  client.on('error', (err) => logger.error({ err }, 'redis error'));
  client.on('connect', () => logger.info('redis connected'));

  return client;
};

/**
 * Wait for the connection to be usable. Called at boot so a failure surfaces
 * in the startup logs rather than as a mysterious 503 on the first request.
 */
export const connectRedis = async (timeoutMs = 10_000) => {
  const redis = getRedis();
  if (redis.status === 'ready') return redis;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('redis connect timed out')), timeoutMs);
    redis.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
    redis.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  logger.info('redis ready');
  return redis;
};

export const closeRedis = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

export default getRedis;
