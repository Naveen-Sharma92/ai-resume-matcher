import pg from 'pg';
import { env } from '../envConfig.js';
import { logger } from '../utils/logger.js';

/**
 * Postgres connection pool (Supabase in production).
 *
 * Same async/try-catch boot pattern as chai-backend's mongoose connect, just
 * with `pg`. Keep `max` small: Supabase's free tier and Render's free instances
 * both have modest connection budgets, and the session pooler is shared.
 */
const { Pool } = pg;

let pool = null;

export const getPool = () => {
  if (pool) return pool;

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'worker-service',
  });

  pool.on('error', (err) => logger.error({ err }, 'unexpected postgres pool error'));

  return pool;
};

/** Thin query helper so controllers never touch the pool directly. */
export const query = async (text, params = []) => {
  const startedAt = Date.now();
  const result = await getPool().query(text, params);
  logger.debug(
    { sql: text.split('\n')[0].trim(), ms: Date.now() - startedAt, rows: result.rowCount },
    'db query'
  );
  return result;
};

/** Run several statements in one transaction. */
export const withTransaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const connectDB = async () => {
  try {
    const { rows } = await getPool().query('SELECT current_database() AS db, version() AS version');
    logger.info({ db: rows[0].db }, 'postgres connected');
    return pool;
  } catch (error) {
    logger.error({ err: error }, 'POSTGRES connection FAILED');
    process.exit(1);
  }
};

export const closeDB = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

export default connectDB;
