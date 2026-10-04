import { env } from '../envConfig.js';
import { logger } from './logger.js';

/**
 * Free-tier accommodation, stated plainly.
 *
 * Render's free plan spins an idle instance down after 15 minutes, and the
 * worker is woken by HTTP, not by Kafka - so a job published while it sleeps
 * waits in the topic until something pokes it. The API knows exactly when a
 * job has been enqueued, so it pokes the worker itself.
 *
 * Fire-and-forget on purpose: the upload response must not wait on it, and a
 * failure here costs nothing because the event is already durably in Kafka.
 * The worker consumes it from its committed offset whenever it next starts.
 */
export const wakeWorker = () => {
  if (!env.WORKER_WAKE_URL) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  fetch(env.WORKER_WAKE_URL, { method: 'GET', signal: controller.signal })
    .then((res) => logger.debug({ status: res.status }, 'worker wake ping sent'))
    .catch((err) => logger.debug({ err: err.message }, 'worker wake ping failed (harmless)'))
    .finally(() => clearTimeout(timer));
};

export default wakeWorker;
