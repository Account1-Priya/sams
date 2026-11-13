/**
 * Authentication + authorisation middleware.
 *
 * In the PHP version each page repeated its own `if (!isset($_SESSION[...]))`
 * check, and several pages (notably upload_marks.php) simply forgot to do it,
 * leaving grade submission open to anyone. Here every protected route goes
 * through one of these guards, so a route cannot accidentally be left open.
 */

export const ROLES = {
  ADMIN: 1,      // Head of Department
  PROFESSOR: 2,
  STUDENT: 3,
};

export const ROLE_NAMES = {
  1: 'Head of Department',
  2: 'Professor',
  3: 'Student',
};

/** Where each role lands after logging in. */
export function homeFor(roleId) {
  switch (Number(roleId)) {
    case ROLES.ADMIN:     return '/admin';
    case ROLES.PROFESSOR: return '/professor';
    case ROLES.STUDENT:   return '/student';
    default:              return '/login';
  }
}

/**
 * Must be logged in with one specific role.
 * Returns 403 rather than redirecting, so a logged-in student poking at
 * /professor/... gets a clear refusal instead of a confusing login loop.
 */
export function requireRole(roleId) {
  return function (req, res, next) {
    const user = req.session?.user;
    if (!user) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    if (Number(user.roleId) !== Number(roleId)) {
      return res.status(403).render('error', {
        title: 'Access denied',
        user,
        status: 403,
        message: `This page is for ${ROLE_NAMES[roleId]} accounts. ` +
                 `You are signed in as ${ROLE_NAMES[user.roleId] ?? 'an unknown role'}.`,
      });
    }
    next();
  };
}

/** Makes the current user available to every template as `user`. */
export function exposeUser(req, res, next) {
  res.locals.user = req.session?.user ?? null;
  res.locals.ROLES = ROLES;
  next();
}
