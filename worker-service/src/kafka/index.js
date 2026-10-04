import { Kafka, logLevel, Partitioners } from 'kafkajs';
import { env } from '../envConfig.js';
import { logger } from '../utils/logger.js';

/**
 * One Kafka client, two roles: consumer of `resume.uploaded`, producer of
 * `match.completed` / DLQ messages.
 *
 * Local dev  : Redpanda (docker-compose), PLAINTEXT.
 * Production : Aiven for Apache Kafka free tier, SASL_SSL + SCRAM-SHA-256.
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

let consumer = null;
let producer = null;

export const getConsumer = () => {
  if (consumer) return consumer;
  consumer = kafka.consumer({
    groupId: env.KAFKA_GROUP_ID,
    sessionTimeout: 45_000,
    heartbeatInterval: 5_000,
    // One LLM round trip per message: fetching a huge batch would only make
    // the session time out while we wait on Gemini.
    maxBytesPerPartition: 512 * 1024,
  });
  return consumer;
};

export const getProducer = () => {
  if (producer) return producer;
  producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    allowAutoTopicCreation: false,
  });
  return producer;
};

export const connectKafka = async () => {
  await getProducer().connect();
  await getConsumer().connect();
  logger.info({ brokers: env.kafkaBrokers, groupId: env.KAFKA_GROUP_ID }, 'kafka connected');
};

export const disconnectKafka = async () => {
  await Promise.allSettled([consumer?.disconnect(), producer?.disconnect()]);
  consumer = null;
  producer = null;
};

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
          ...headers,
        },
      },
    ],
  });
  logger.info({ topic, key }, 'event published');
};
