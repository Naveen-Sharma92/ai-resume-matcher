#!/usr/bin/env node
/**
 * Tiny forward-only migration runner.
 *
 * Applies every .sql file in db/migrations in filename order, recording what
 * ran in a `schema_migrations` table so it is safe to re-run. Deliberately
 * dependency-light: it only needs `pg`, which both services already have.
 *
 *   DATABASE_URL=postgres://... node scripts/migrate.js
 *   DATABASE_URL=postgres://... node scripts/migrate.js --seed   # include 002_seed_dev.sql
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const withSeed = process.argv.includes('--seed');

/**
 * SSL: DATABASE_SSL wins when it is set (same contract as both services).
 * Otherwise guess from the host - a managed database needs TLS, a local one
 * (Docker, localhost) does not and will refuse the handshake outright.
 */
const sslEnv = process.env.DATABASE_SSL;
const useSsl =
  sslEnv === undefined || sslEnv === ''
    ? !/@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(databaseUrl)
    : sslEnv === 'true' || sslEnv === '1';

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 1,
});

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const applied = new Set(
    (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => withSeed || !f.includes('seed'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`- skip ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`+ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`x failed ${file}:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('migrations up to date');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    await pool.end();
    console.error(err);
    process.exit(1);
  });
