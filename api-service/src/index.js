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

  // A platform SIGTERM is a normal event, so this must ALWAYS end in exit(0).
  // Exiting non-zero here makes Render read a routine restart as a failed
  // deploy and retry forever.
  const failsafe = setTimeout(() => {
    logger.warn('shutdown timed out - exiting anyway');
    process.exit(0);
  }, 10_000);
  failsafe.unref();

  try {
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      // Health checkers hold keep-alive sockets open, and server.close() waits
      // for them: drop the idle ones now and the rest shortly after.
      server.closeIdleConnections?.();
      setTimeout(() => server.closeAllConnections?.(), 3000).unref();
      await closed;
    }
    await disconnectKafka();
    await closeRedis();
    await closeDB();
    logger.info('shutdown complete');
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
  } finally {
    clearTimeout(failsafe);
    process.exit(0);
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
