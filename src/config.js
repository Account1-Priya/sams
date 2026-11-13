import 'dotenv/config';

/**
 * Central configuration, read from environment variables (.env).
 * Nothing secret is ever hard-coded here - see .env.example.
 */

const required = (name, fallback = undefined) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
      `Copy .env.example to .env and fill it in.`
    );
  }
  return v;
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Session signing secret. No fallback ON PURPOSE: a default here would be a
  // published string, so a host that forgot to set the variable would boot
  // with a secret anyone could read off the repo and use to forge a session
  // cookie for any account. Failing to start is the safe outcome.
  sessionSecret: required('SESSION_SECRET'),

  db: {
    // Supabase gives you this under: Project Settings -> Database -> Connection string
    // Use the "Session pooler" URI (port 5432) - the direct db.<ref>.supabase.co
    // host is IPv6-only unless you have the IPv4 add-on.
    connectionString: process.env.DATABASE_URL ?? '',

    // Supabase requires TLS. Local PGlite dev server does not support it.
    ssl: (process.env.DATABASE_SSL ?? 'true').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
  },
};

export const isProd = config.nodeEnv === 'production';
