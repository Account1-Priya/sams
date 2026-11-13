/**
 * Apply schema.sql to whatever DATABASE_URL points at (normally Supabase).
 *
 *   npm run db:push
 *
 * WARNING: schema.sql begins with DROP TABLE ... CASCADE, so this REPLACES
 * the SAMS tables and everything in them. You are asked to confirm first.
 */
import 'dotenv/config';
import pg from 'pg';
import readline from 'node:readline/promises';
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

// Show where we are pointing WITHOUT printing the password.
let target = 'unknown';
try {
  const u = new URL(url);
  target = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch { /* ignore */ }

const ssl = (process.env.DATABASE_SSL ?? 'true').toLowerCase() === 'true'
  ? { rejectUnauthorized: false } : false;

console.log(`\n  Target database : ${target}`);
console.log(`  Schema file     : ${schemaPath}`);
console.log('\n  This DROPS and recreates every SAMS table, deleting any data in them.');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('  Type "yes" to continue: ')).trim().toLowerCase();
rl.close();

if (answer !== 'yes') {
  console.log('  Cancelled. Nothing was changed.');
  process.exit(0);
}

const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
console.log('\n  Connected. Applying schema ...');

try {
  await client.query(readFileSync(schemaPath, 'utf8'));
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log(`  Done. ${rows.length} tables present:`);
  console.log('    ' + rows.map((r) => r.table_name).join(', '));
  console.log('\n  Demo accounts use the password Pass@123\n');
} catch (err) {
  console.error('\n  FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
