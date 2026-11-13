import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import path from 'node:path';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { config, isProd } from './src/config.js';
import { assertConnection, pool } from './src/db.js';
import { csrf } from './src/middleware/csrf.js';
import { exposeUser, homeFor } from './src/middleware/auth.js';
import * as viz from './src/viz.js';
import { authRouter } from './src/routes/auth.js';
import { studentRouter } from './src/routes/student.js';
import { professorRouter } from './src/routes/professor.js';
import { adminRouter } from './src/routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

/* ---------------------------------------------------------------- views */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* ----------------------------------------------------------- middleware */
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

/* Static assets are cached hard in production, so their URLs have to change
   when they do. Without this, a deploy ships new HTML while browsers keep the
   style.css / app.js they cached days ago - the page renders with stale CSS
   and dead scripts until the cache expires. The stamp is derived from the
   files themselves, so it only changes when they change. */
const assetVersion = createHash('sha1')
  .update(['css/style.css', 'js/app.js'].map((f) => {
    try {
      const st = statSync(path.join(__dirname, 'public', f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch { return f; }
  }).join('|'))
  .digest('hex')
  .slice(0, 8);
app.locals.assetVersion = assetVersion;

// Minimal security headers (no extra dependency needed for this project's scope)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

if (isProd) app.set('trust proxy', 1);

/* Liveness probe. Deliberately mounted ABOVE the session middleware: the host
   polls this constantly, and below the session it would allocate a throwaway
   session per ping. It reports that the process is up and serving, not that
   the database is reachable - the app stays useful (and recoverable) while
   the database is down, so a DB blip should not cause a restart loop. */
app.get('/healthz', (req, res) => res.type('text').send('ok'));

/* Sessions live in Postgres, not in process memory. The old MemoryStore lost
   every session whenever the process restarted - which on a sleeping free-tier
   host is routine - and because the CSRF token lives in the session, a user
   mid-form came back to a 403 rather than a login prompt. This reuses the
   application pool rather than opening a second one. */
const PgStore = connectPgSimple(session);

app.use(session({
  name: 'sams.sid',
  store: new PgStore({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15,   // seconds
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,          // requires HTTPS in production
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

app.use(exposeUser);
app.use(csrf);

// Chart components available to every template as `viz`.
app.use((req, res, next) => { res.locals.viz = viz; next(); });

/* --------------------------------------------------------------- routes */
app.get('/', (req, res) => {
  res.redirect(req.session.user ? homeFor(req.session.user.roleId) : '/login');
});

app.use('/', authRouter);
app.use('/student', studentRouter);
app.use('/professor', professorRouter);
app.use('/admin', adminRouter);

/* ------------------------------------------------------------ 404 + 500 */
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    status: 404,
    message: `There is nothing at ${req.path}.`,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // Log the detail for the developer; show the user something safe.
  // The PHP pages printed raw SQL errors straight to the browser.
  console.error('[error]', err);

  // If the response is already on the wire there is no error page left to
  // send, and trying anyway throws ERR_HTTP_HEADERS_SENT on top of the real
  // error - which buries it. Hand those to Express, which closes the socket.
  if (res.headersSent) return _next(err);

  /* Codes that mean "the database is not reachable", as opposed to a bug.
     ENETUNREACH belongs here: it is what a host with no IPv6 route returns
     when DATABASE_URL points at a database that only publishes an AAAA
     record, which is the single easiest way to misconfigure this deploy. */
  const dbDown = [
    'ECONNREFUSED',   // nothing listening
    'ENOTFOUND',      // hostname does not resolve
    'ETIMEDOUT',      // no answer
    'ENETUNREACH',    // no route to that address family (IPv6-only host)
    'EHOSTUNREACH',   // no route to that host
    'ECONNRESET',     // connection dropped mid-query
    '28P01',          // password authentication failed
    '3D000',          // database does not exist
  ].includes(err.code);

  res.status(500).render('error', {
    title: dbDown ? 'Database unavailable' : 'Something went wrong',
    status: 500,
    message: dbDown
      ? 'The application could not reach the database. Check DATABASE_URL - on a host ' +
        'without IPv6 it must point at a pooler, not a direct database host. Locally, ' +
        'start the test database with "npm run devdb".'
      : 'An unexpected error occurred. The details have been logged to the server console.',
    detail: isProd ? null : (err.stack ?? String(err)),
  });
});

/* --------------------------------------------------------------- start */
const server = app.listen(config.port, async () => {
  console.log(`\n  SAMS running at  http://localhost:${config.port}`);
  try {
    const info = await assertConnection();
    console.log(`  Database         connected (${info.db})`);
    console.log(`  ${info.version.split(',')[0]}\n`);
  } catch (err) {
    console.warn(`  Database         NOT CONNECTED - ${err.message}`);
    console.warn('  Pages will show a "Database unavailable" message until this is fixed.\n');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nShutting down.');
    server.close(() => process.exit(0));
  });
}
