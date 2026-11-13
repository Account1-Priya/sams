/**
 * First-time schema load. NON-DESTRUCTIVE BY CONSTRUCTION.
 *
 *   npm run db:init
 *
 * Refuses to do anything if the public schema already contains tables, so it
 * can never drop or overwrite existing data. To deliberately replace an
 * existing schema, use `npm run db:push`, which asks for confirmation first.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'schema.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

let where = 'unknown';
try {
  const u = new URL(url);
  where = `${u.hostname}:${u.port || 5432}${u.pathname}`;   // never the password
} catch { /* ignore */ }

const ssl = (process.env.DATABASE_SSL ?? 'true').toLowerCase() === 'true'
  ? { rejectUnauthorized: false } : false;

const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 20_000 });

try {
  console.log(`\n  Target : ${where}`);
  await client.connect();

  const { rows: existing } = await client.query(`
    SELECT c.relname AS t
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'`);

  if (existing.length) {
    console.error(
      `\n  REFUSING TO RUN - the public schema already has ${existing.length} table(s):\n` +
      `    ${existing.map((r) => r.t).join(', ')}\n\n` +
      `  This tool only initialises an empty schema, so it cannot destroy data.\n` +
      `  To deliberately replace them, run:  npm run db:push\n`
    );
    process.exitCode = 1;
  } else {
    console.log('  Public schema is empty. Applying schema.sql ...');
    await client.query(readFileSync(schemaPath, 'utf8'));

    const { rows: made } = await client.query(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`);

    const counts = await client.query(`
      SELECT (SELECT COUNT(*) FROM users)        AS users,
             (SELECT COUNT(*) FROM students)     AS students,
             (SELECT COUNT(*) FROM professors)   AS professors,
             (SELECT COUNT(*) FROM courses)      AS courses,
             (SELECT COUNT(*) FROM classes)      AS classes,
             (SELECT COUNT(*) FROM attendance)   AS attendance,
             (SELECT COUNT(*) FROM midsem_marks) AS marks`);

    console.log(`\n  Created ${made.length} tables:`);
    console.log('    ' + made.map((r) => r.table_name).join(', '));
    console.log('\n  Seeded rows:');
    for (const [k, v] of Object.entries(counts.rows[0])) {
      console.log(`    ${k.padEnd(12)} ${v}`);
    }
    console.log('\n  Demo accounts use the password  Pass@123\n');
  }
} catch (err) {
  console.error(`\n  FAILED: ${err.message}`);
  if (err.code) console.error(`  code: ${err.code}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
