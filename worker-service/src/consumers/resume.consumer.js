import { TOPICS, resumeUploadedSchema } from '@arm/shared/events';
import { getConsumer } from '../kafka/index.js';
import { logger } from '../utils/logger.js';
import { processMatchJob, handleJobFailure } from '../controllers/match.controller.js';
import { recordProcessed, recordFailed, setConsumerRunning } from '../workerState.js';

/** Exported for tests: process one Kafka message end to end. */
export const handleMessage = async ({ topic, partition, message }) => {
  const raw = message.value?.toString('utf8');
  const log = logger.child({
    topic,
    partition,
    offset: message.offset,
    requestId: message.headers?.['x-request-id']?.toString(),
  });

  let event;
  try {
    event = resumeUploadedSchema.parse(JSON.parse(raw ?? ''));
  } catch (err) {
    // A malformed message will never parse, no matter how often we retry it.
    // Log it and move the offset on rather than blocking the partition.
    log.error({ err, raw: raw?.slice(0, 300) }, 'unparseable event - skipping');
    return { skipped: true };
  }

  log.info({ matchId: event.matchId, eventId: event.eventId }, 'processing match job');

  try {
    const result = await processMatchJob(event);
    recordProcessed(event.matchId);
    return result;
  } catch (error) {
    recordFailed();
    const { retry } = await handleJobFailure({
      event,
      error,
      contextInfo: { offset: message.offset },
    });
    // Rethrowing makes kafkajs redeliver the batch (its own retry/backoff);
    // swallowing it commits the offset and moves on.
    if (retry) throw error;
    return { failed: true };
  }
};

export const startResumeConsumer = async () => {
  const consumer = getConsumer();

  await consumer.subscribe({ topic: TOPICS.RESUME_UPLOADED, fromBeginning: false });

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
    // One message at a time: each one costs an LLM call, so concurrency here
    // would just blow through the Gemini free-tier quota.
    partitionsConsumedConcurrently: 1,
    eachMessage: handleMessage,
  });

  setConsumerRunning(true);
  logger.info({ topic: TOPICS.RESUME_UPLOADED }, 'consumer running');
  return consumer;
};

export default startResumeConsumer;
