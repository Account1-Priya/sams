import crypto from 'node:crypto';

/**
 * Minimal CSRF protection for every state-changing request.
 *
 * The PHP version only protected the login form; attendance marking and marks
 * upload had no token at all, so any other site could silently submit them on
 * a logged-in user's behalf. This guards every POST.
 *
 * (The well-known `csurf` package is deprecated, so this is a small
 * session-backed implementation rather than a dependency.)
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Available to every template as <%= csrfToken %>
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const sent = req.body?._csrf ?? req.get('x-csrf-token') ?? '';
  const expected = req.session.csrfToken;

  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(expected));

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('error', {
      title: 'Request blocked',
      user: req.session?.user ?? null,
      status: 403,
      message:
        'Your session expired or the form was submitted from an untrusted page. ' +
        'Please go back, reload, and try again.',
    });
  }

  next();
}
