/**
 * worker-service entry point.
 *
 * Boots the health server first (so Render sees an open port immediately and
 * does not kill the deploy), then connects to Postgres and Kafka and starts
 * consuming.
 */
import { env } from './envConfig.js';
import { app } from './app.js';
import connectDB, { closeDB } from './db/index.js';
import { connectKafka, disconnectKafka } from './kafka/index.js';
import { startResumeConsumer } from './consumers/resume.consumer.js';
import { setConsumerRunning } from './workerState.js';
import { connectRedis, closeRedis } from './utils/redis.js';
import { logger } from './utils/logger.js';

let server;

const start = async () => {
  server = app.listen(env.PORT, () =>
    logger.info({ port: env.PORT }, 'worker health server listening')
  );

  await connectDB();
  await connectRedis().catch((err) => logger.warn({ err: err.message }, 'redis not ready at boot'));
  await connectKafka();
  await startResumeConsumer();

  logger.info({ env: env.NODE_ENV }, 'worker-service ready');
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
    setConsumerRunning(false);
    // Consumer first, so the group rebalances cleanly and an in-flight message
    // is redelivered rather than silently lost.
    await disconnectKafka();

    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      // Health checkers hold keep-alive sockets open, and server.close() waits
      // for them: drop the idle ones now and the rest shortly after.
      server.closeIdleConnections?.();
      setTimeout(() => server.closeAllConnections?.(), 3000).unref();
      await closed;
    }
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
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));

start().catch((err) => {
  logger.error({ err }, 'failed to start worker-service');
  process.exit(1);
});
