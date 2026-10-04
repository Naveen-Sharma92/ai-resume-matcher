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
import { closeRedis } from './utils/redis.js';
import { logger } from './utils/logger.js';

let server;

const start = async () => {
  server = app.listen(env.PORT, () =>
    logger.info({ port: env.PORT }, 'worker health server listening')
  );

  await connectDB();
  await connectKafka();
  await startResumeConsumer();

  logger.info({ env: env.NODE_ENV }, 'worker-service ready');
};

const shutdown = async (signal) => {
  logger.info({ signal }, 'shutting down worker');
  const timer = setTimeout(() => process.exit(1), 15_000).unref();
  try {
    setConsumerRunning(false);
    // Disconnect the consumer first so the group rebalances cleanly and the
    // in-flight message is redelivered rather than silently lost.
    await disconnectKafka();
    if (server) await new Promise((resolve) => server.close(resolve));
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
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));

start().catch((err) => {
  logger.error({ err }, 'failed to start worker-service');
  process.exit(1);
});
