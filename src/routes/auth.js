import express from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne, withTransaction } from '../db.js';
import { ROLES, homeFor } from '../middleware/auth.js';

export const authRouter = express.Router();

/** Table that proves a user really holds the role they claim. */
const BRIDGE_TABLE = {
  [ROLES.ADMIN]:     'adminusers',
  [ROLES.PROFESSOR]: 'professorusers',
  [ROLES.STUDENT]:   'studentusers',
};

/* ------------------------------------------------------------------ login */

authRouter.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user.roleId));
  res.render('login', {
    title: 'Sign in',
    error: null,
    values: {},
    next: req.query.next ?? '',
    registered: Boolean(req.query.registered),
  });
});

authRouter.post('/login', async (req, res, next) => {
  const roleId = Number(req.body.role);
  const username = String(req.body.username ?? '').trim();

  // NOTE: the password is used exactly as typed.
  // The PHP version ran htmlspecialchars() on it here but not at signup, so
  // any password containing < > & " ' could never log in again.
  const password = String(req.body.password ?? '');

  const rerender = (error) =>
    res.status(401).render('login', {
      title: 'Sign in',
      error,
      values: { role: req.body.role, username },
      next: req.body.next ?? '',
      registered: false,
    });

  try {
    if (!roleId || !username || !password) {
      return rerender('Please fill in every field.');
    }
    if (!BRIDGE_TABLE[roleId]) {
      return rerender('Please choose a valid role.');
    }

    const user = await queryOne(
      'SELECT user_id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    // One generic message for every failure path, so the form cannot be used
    // to discover which usernames exist (the PHP version said "Invalid
    // password!" vs "Invalid username or role!").
    const GENERIC = 'Incorrect username, password, or role.';

    if (!user) {
      await bcrypt.compare(password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
      return rerender(GENERIC);
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return rerender(GENERIC);

    const bridge = await queryOne(
      `SELECT 1 AS ok FROM ${BRIDGE_TABLE[roleId]} WHERE user_id = $1`,
      [user.user_id]
    );
    if (!bridge) return rerender(GENERIC);

    // Regenerate the session ID on privilege change to prevent session
    // fixation - the PHP version never did this.
    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = {
        id: user.user_id,
        username: user.username,
        roleId,
      };

      // Best-effort audit trail. The auditlogs table existed in the old
      // schema but nothing ever wrote to it.
      query(
        'INSERT INTO auditlogs (user_id, login_time, ip_address) VALUES ($1, NOW(), $2)',
        [user.user_id, req.ip ?? null]
      ).catch((e) => console.warn('audit log failed:', e.message));

      /* Only a path on THIS site is an acceptable post-login destination.
         "starts with /" alone is not enough: a browser reads "//evil.example"
         and "/\evil.example" as absolute URLs, so a crafted ?next= link would
         hand the user straight to another site immediately after they signed
         in here - carrying this domain's authority with it. */
      const wanted = typeof req.body.next === 'string' ? req.body.next : '';
      const isLocalPath =
        wanted.startsWith('/') &&
        wanted.charCodeAt(1) !== 47 &&   // 47 = / ; "//host" is an absolute URL
        wanted.charCodeAt(1) !== 92;    // 92 = \ ; browsers read "/\host" as absolute too
      const target = isLocalPath ? wanted : homeFor(roleId);

      req.session.save(() => res.redirect(target));
    });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------------- logout */

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sams.sid');
    res.redirect('/login');
  });
});

/* ----------------------------------------------------------------- signup */

authRouter.get('/signup', (req, res) => {
  res.render('signup-role', { title: 'Create an account' });
});

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
const USERNAME_RULE = /^[A-Za-z0-9_]+$/;

function validateAccount({ password, confirm_password, email }) {
  if (password !== confirm_password) return 'The two passwords do not match.';
  if (!PASSWORD_RULE.test(password)) {
    return 'Password must be at least 8 characters and include a letter, a number, ' +
           'and one of @ $ ! % * ? & #';
  }
  if (!/^\S+@\S+\.\S+$/.test(String(email ?? ''))) return 'Please enter a valid email address.';
  return null;
}

/* --- student ------------------------------------------------------------ */

authRouter.get('/signup/student', async (req, res, next) => {
  try {
    res.render('signup-student', {
      title: 'Student sign-up',
      error: null,
      values: {},
      departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
      semesters: await query('SELECT semester_id, semester_name FROM semesters ORDER BY semester_id'),
    });
  } catch (err) { next(err); }
});

authRouter.post('/signup/student', async (req, res, next) => {
  const b = req.body;
  const enrollment = String(b.enrollment_number ?? '').trim();

  const rerender = async (error) =>
    res.status(400).render('signup-student', {
      title: 'Student sign-up',
      error,
      values: b,
      departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
      semesters: await query('SELECT semester_id, semester_name FROM semesters ORDER BY semester_id'),
    });

  try {
    const problem = validateAccount(b);
    if (problem) return rerender(problem);

    // The student dashboard looks a student up by enrollment_no == username,
    // and rejects anything non-alphanumeric, so enforce that at signup.
    if (!USERNAME_RULE.test(enrollment)) {
      return rerender('Enrollment number may only contain letters, numbers and underscores.');
    }
    if (!b.department_id || !b.semester_id || !String(b.session ?? '').trim()) {
      return rerender('Please fill in department, semester and session.');
    }

    const clash = await queryOne('SELECT 1 FROM users WHERE username = $1', [enrollment]);
    if (clash) return rerender('That enrollment number is already registered.');

    const hash = await bcrypt.hash(b.password, 10);

    await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        `INSERT INTO users (username, password_hash, email, created_at, role_id)
         VALUES ($1, $2, $3, NOW(), $4) RETURNING user_id`,
        [enrollment, hash, b.email, ROLES.STUDENT]
      );
      const { rows: [student] } = await client.query(
        `INSERT INTO students
           (first_name, last_name, enrollment_no, email, phone, department_id, semester_id, session)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING student_id`,
        [b.first_name, b.last_name, enrollment, b.email, b.phone,
         b.department_id, b.semester_id, b.session]
      );
      await client.query(
        'INSERT INTO studentusers (student_id, user_id) VALUES ($1, $2)',
        [student.student_id, user.user_id]
      );
    });

    res.redirect('/login?registered=1');
  } catch (err) {
    if (err.code === '23505') return rerender('That enrollment number or email is already registered.');
    next(err);
  }
});

/* --- professor ---------------------------------------------------------- */

authRouter.get('/signup/professor', async (req, res, next) => {
  try {
    res.render('signup-professor', {
      title: 'Professor sign-up',
      error: null,
      values: {},
      departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
    });
  } catch (err) { next(err); }
});

authRouter.post('/signup/professor', async (req, res, next) => {
  const b = req.body;
  const username = String(b.username ?? '').trim();

  const rerender = async (error) =>
    res.status(400).render('signup-professor', {
      title: 'Professor sign-up',
      error,
      values: b,
      departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
    });

  try {
    const problem = validateAccount(b);
    if (problem) return rerender(problem);
    if (!USERNAME_RULE.test(username)) {
      return rerender('Username may only contain letters, numbers and underscores.');
    }
    if (!b.department_id) return rerender('Please choose a department.');

    const clash = await queryOne('SELECT 1 FROM users WHERE username = $1', [username]);
    if (clash) return rerender('That username is already taken.');

    const hash = await bcrypt.hash(b.password, 10);

    await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        `INSERT INTO users (username, password_hash, email, created_at, role_id)
         VALUES ($1, $2, $3, NOW(), $4) RETURNING user_id`,
        [username, hash, b.email, ROLES.PROFESSOR]
      );
      const { rows: [prof] } = await client.query(
        `INSERT INTO professors (first_name, last_name, username, email, phone, department_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING professor_id`,
        [b.first_name, b.last_name, username, b.email, b.phone, b.department_id]
      );
      await client.query(
        'INSERT INTO professorusers (professor_id, user_id, username) VALUES ($1, $2, $3)',
        [prof.professor_id, user.user_id, username]
      );
    });

    res.redirect('/login?registered=1');
  } catch (err) {
    if (err.code === '23505') return rerender('That username or email is already registered.');
    next(err);
  }
});
