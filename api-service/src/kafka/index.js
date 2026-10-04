import { Kafka, logLevel, Partitioners } from 'kafkajs';
import { TOPICS, TOPIC_PARTITIONS } from '@arm/shared/events';
import { env } from '../envConfig.js';
import { logger } from '../utils/logger.js';

/**
 * Kafka producer.
 *
 * Local dev  : Redpanda from docker-compose, PLAINTEXT.
 * Production : Aiven for Apache Kafka free tier, SASL_SSL + SCRAM-SHA-256 and
 *              their CA certificate (pass it base64-encoded in KAFKA_CA_CERT_B64).
 */
const buildSsl = () => {
  if (!env.KAFKA_SSL) return false;
  if (!env.KAFKA_CA_CERT_B64) return true;
  return { ca: [Buffer.from(env.KAFKA_CA_CERT_B64, 'base64').toString('utf8')] };
};

const buildSasl = () =>
  env.KAFKA_SASL_MECHANISM
    ? {
        mechanism: env.KAFKA_SASL_MECHANISM,
        username: env.KAFKA_USERNAME,
        password: env.KAFKA_PASSWORD,
      }
    : undefined;

export const kafka = new Kafka({
  clientId: env.KAFKA_CLIENT_ID,
  brokers: env.kafkaBrokers,
  ssl: buildSsl(),
  sasl: buildSasl(),
  connectionTimeout: 10_000,
  requestTimeout: 30_000,
  retry: { initialRetryTime: 300, retries: 8 },
  logLevel: env.isProduction ? logLevel.WARN : logLevel.INFO,
});

let producer = null;

export const getProducer = () => {
  if (producer) return producer;
  producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    allowAutoTopicCreation: false,
    idempotent: true,
  });
  return producer;
};

export const connectKafka = async () => {
  await getProducer().connect();
  logger.info({ brokers: env.kafkaBrokers }, 'kafka producer connected');
};

export const disconnectKafka = async () => {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
};

/**
 * Creates the topics once at boot. Aiven's free tier allows 5 topics x 2
 * partitions, which is exactly what TOPIC_PARTITIONS encodes.
 */
export const ensureTopics = async () => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existing = await admin.listTopics();
    const missing = Object.values(TOPICS).filter((t) => !existing.includes(t));
    if (missing.length) {
      await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((topic) => ({
          topic,
          numPartitions: TOPIC_PARTITIONS,
          // Aiven free tier runs 3 brokers; local Redpanda runs 1.
          replicationFactor: env.isProduction ? 2 : 1,
        })),
      });
      logger.info({ created: missing }, 'kafka topics created');
    }
  } catch (err) {
    // Not fatal: managed clusters often disallow admin APIs, in which case you
    // create the topics once from the provider console.
    logger.warn({ err: err.message }, 'could not ensure kafka topics - create them manually');
  } finally {
    await admin.disconnect().catch(() => {});
  }
};

/**
 * Publish an event. The Kafka key is the matchId so all events for one match
 * share a partition and keep their relative order.
 */
export const publishEvent = async ({ topic, key, event, headers = {} }) => {
  await getProducer().send({
    topic,
    messages: [
      {
        key: String(key),
        value: JSON.stringify(event),
        headers: {
          'content-type': 'application/json',
          'event-type': event.eventType ?? topic,
          'event-version': String(event.eventVersion ?? 1),
          ...headers,
        },
      },
    ],
  });
  logger.info({ topic, key, eventId: event.eventId }, 'event published');
};
