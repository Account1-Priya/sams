/**
 * Local development database.
 *
 * Runs PGlite (PostgreSQL compiled to WebAssembly) and exposes it on a normal
 * Postgres port, so the app can talk to it with the exact same `pg` driver and
 * SQL it will use against Supabase. No install, no Docker, no XAMPP.
 *
 *   npm run devdb      (leave running in its own terminal)
 *
 * Then point .env at it:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres
 *   DATABASE_SSL=false
 *
 * Data persists in .pgdata/ between runs. Delete that folder to start over.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.DEVDB_PORT ?? 55432);
const DATA_DIR = path.join(root, '.pgdata');
const SCHEMA = path.join(root, 'schema.sql');

const fresh = !existsSync(DATA_DIR);
const db = await PGlite.create({ dataDir: DATA_DIR });

if (fresh) {
  if (!existsSync(SCHEMA)) {
    console.error('schema.sql not found at', SCHEMA);
    process.exit(1);
  }
  console.log('First run - loading schema.sql ...');
  await db.exec(readFileSync(SCHEMA, 'utf8'));
  console.log('Schema loaded with demo data.');
} else {
  console.log('Using existing database in .pgdata/');
}

const counts = await db.query(`
  SELECT (SELECT COUNT(*) FROM users)      AS users,
         (SELECT COUNT(*) FROM students)   AS students,
         (SELECT COUNT(*) FROM attendance) AS attendance
`);

// PGlite is a single-connection database. The socket server multiplexes over
// it, but defaults to maxConnections: 1 - which resets any extra connection a
// normal pg Pool opens. Raise it so the app's pool behaves as it would against
// a real Postgres.
const server = new PGLiteSocketServer({
  db,
  port: PORT,
  host: '127.0.0.1',
  maxConnections: 20,
});
await server.start();

const c = counts.rows[0];
console.log(`
  Local Postgres ready
  ---------------------------------------------------------------
  DATABASE_URL=postgresql://postgres@127.0.0.1:${PORT}/postgres
  DATABASE_SSL=false

  users: ${c.users}   students: ${c.students}   attendance: ${c.attendance}
  Demo password: Pass@123

  Press Ctrl+C to stop.
`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('\nStopping local database.');
    await server.stop();
    await db.close();
    process.exit(0);
  });
}
