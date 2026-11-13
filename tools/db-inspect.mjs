/**
 * Read-only look at whatever DATABASE_URL points at.
 *
 *   npm run db:inspect
 *
 * Use this before `npm run db:push`, which drops and recreates tables.
 * Never prints the password.
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

let where = 'unknown';
try {
  const u = new URL(url);
  where = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch { /* ignore */ }

const ssl = (process.env.DATABASE_SSL ?? 'true').toLowerCase() === 'true'
  ? { rejectUnauthorized: false } : false;

const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 20_000 });

try {
  console.log(`\n  Connecting to ${where} ...`);
  await client.connect();

  const v = await client.query('SELECT version()');
  console.log(`  Connected.\n  ${v.rows[0].version.split(' on ')[0]}\n`);

  const { rows } = await client.query(`
    SELECT c.relname AS table_name,
           COALESCE(s.n_live_tup, 0)::bigint AS approx_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
 LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname`);

  if (!rows.length) {
    console.log('  The public schema has NO tables - safe to load schema.sql.\n');
  } else {
    console.log(`  ${rows.length} existing table(s) in the public schema:`);
    for (const r of rows) {
      // exact count, since n_live_tup is only an estimate
      const { rows: [c] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.${JSON.stringify(r.table_name).replace(/"/g, '"')}`
      );
      console.log(`    ${r.table_name.padEnd(22)} ${c.n} row(s)`);
    }
    console.log('\n  NOTE: npm run db:push DROPS these and recreates them.\n');
  }
} catch (err) {
  console.error(`\n  Could not connect: ${err.message}`);
  if (err.code) console.error(`  code: ${err.code}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
