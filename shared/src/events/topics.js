/**
 * Kafka topic names.
 *
 * Aiven's free Kafka tier allows 5 topics x 2 partitions, so the topology is
 * deliberately small: one work topic, one result topic, one dead-letter topic.
 */
export const TOPICS = Object.freeze({
  RESUME_UPLOADED: 'resume.uploaded',
  MATCH_COMPLETED: 'match.completed',
  MATCH_FAILED_DLQ: 'match.failed.dlq',
});

/** Consumer group used by worker-service. */
export const CONSUMER_GROUPS = Object.freeze({
  MATCH_WORKER: 'match-worker-group',
});

export const TOPIC_PARTITIONS = 2;
export const TOPIC_REPLICATION_FACTOR = 2;
