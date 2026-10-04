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
  LOG_LEVEL: z.string().default('info'),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: boolish(false),

  REDIS_URL: z.string().min(1),
  EMBEDDING_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  KAFKA_CLIENT_ID: z.string().default('worker-service'),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_GROUP_ID: z.string().default('match-worker-group'),
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

  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_CHAT_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  GEMINI_EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  GEMINI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(4),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  MAX_RESUME_CHARS: z.coerce.number().int().positive().default(60_000),
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
  isProduction: parsed.data.NODE_ENV === 'production',
});

export default env;
