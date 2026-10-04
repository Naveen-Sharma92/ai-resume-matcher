/**
 * api-service entry point.
 *
 * Order matters: validate env -> connect Postgres -> connect Kafka -> listen.
 * If any dependency is unreachable we exit non-zero so Render marks the deploy
 * as failed instead of serving a half-broken API.
 */
import { env } from './envConfig.js';
import { app } from './app.js';
import connectDB, { closeDB } from './db/index.js';
import { connectKafka, disconnectKafka, ensureTopics } from './kafka/index.js';
import { closeRedis } from './utils/redis.js';
import { logger } from './utils/logger.js';

let server;

const start = async () => {
  await connectDB();
  await connectKafka();
  await ensureTopics();

  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'api-service listening');
  });

  server.on('error', (err) => {
    logger.error({ err }, 'http server error');
    process.exit(1);
  });
};

const shutdown = async (signal) => {
  logger.info({ signal }, 'shutting down');
  const timer = setTimeout(() => process.exit(1), 10_000).unref();
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectKafka();
    await closeRedis();
    await closeDB();
    clearTimeout(timer);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});

start().catch((err) => {
  logger.error({ err }, 'failed to start api-service');
  process.exit(1);
});
