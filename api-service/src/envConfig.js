/**
 * Loads .env and validates it with zod at boot.
 * The process refuses to start with a bad config instead of failing later
 * on the first request - much easier to debug on Render.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: process.env.ENV_FILE || '.env' });

const boolish = (defaultValue) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: boolish(false),

  ACCESS_TOKEN_SECRET: z.string().min(8),
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z.string().min(8),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),

  REDIS_URL: z.string().min(1),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  // Optional: the worker's health URL. Set on free hosting where the worker
  // sleeps when idle; leave empty anywhere the worker runs continuously.
  WORKER_WAKE_URL: z.string().optional().default(''),

  KAFKA_CLIENT_ID: z.string().default('api-service'),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_SSL: boolish(false),
  KAFKA_SASL_MECHANISM: z.string().optional().default(''),
  KAFKA_USERNAME: z.string().optional().default(''),
  KAFKA_PASSWORD: z.string().optional().default(''),
  KAFKA_CA_CERT_B64: z.string().optional().default(''),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_BUCKET: z.string().min(1),
  // Point at MinIO/LocalStack for local dev; leave empty to use real AWS S3.
  S3_ENDPOINT: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: boolish(false),
  S3_PRESIGN_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  kafkaBrokers: parsed.data.KAFKA_BROKERS.split(',')
    .map((b) => b.trim())
    .filter(Boolean),
  corsOrigins:
    parsed.data.CORS_ORIGIN === '*'
      ? '*'
      : parsed.data.CORS_ORIGIN.split(',')
          .map((o) => o.trim())
          .filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
});

export default env;
