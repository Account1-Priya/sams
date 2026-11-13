import pg from 'pg';
import { config } from './config.js';

/**
 * Return DATE and TIMESTAMP columns as plain strings.
 *
 * By default node-postgres turns a DATE into a JS Date at LOCAL midnight.
 * Formatting that back through toISOString() then shifts it into UTC, so in
 * any timezone ahead of UTC every date rendered one day early - a class held
 * on the 3rd displayed as the 2nd. An attendance date has no timezone: it is
 * a calendar day, so keep it as the 'YYYY-MM-DD' text Postgres already sends.
 */
pg.types.setTypeParser(1082, (v) => v);   // date
pg.types.setTypeParser(1114, (v) => v);   // timestamp without time zone

/**
 * One shared connection pool for the whole app.
 *
 * Every query in this project goes through here and uses $1, $2 ... placeholders.
 * Values are NEVER concatenated into SQL strings, which is what made the old
 * PHP pages (midsem_marks.php, upload_marks.php) injectable.
 */

if (!config.db.connectionString) {
  console.error(
    '\n  DATABASE_URL is not set.\n' +
    '  Copy .env.example to .env and paste your Supabase connection string,\n' +
    '  or run "npm run devdb" in another terminal to use the local test database.\n'
  );
}

export const pool = new pg.Pool({
  connectionString: config.db.connectionString,
  ssl: config.db.ssl,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('Unexpected idle client error:', err.message);
});

/** Run a query and get the rows back. */
export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

/** Run a query expecting at most one row. Returns the row or null. */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

/**
 * Run several statements inside a single transaction.
 *
 * The old signup pages had no transaction: if the users INSERT succeeded but
 * the students INSERT failed, you were left with an orphaned account that
 * could log in but had no profile. This makes that impossible.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
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
}

/** Verify the database is reachable; called once at startup. */
export async function assertConnection() {
  const row = await queryOne('SELECT current_database() AS db, version() AS version');
  return row;
}
