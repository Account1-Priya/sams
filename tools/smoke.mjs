/**
 * End-to-end smoke test.
 *
 * Exercises every role through real HTTP requests, and checks that each of the
 * critical bugs found in the PHP version is actually fixed.
 *
 *   npm run devdb      (terminal 1)
 *   npm start          (terminal 2)
 *   npm run smoke      (terminal 3)
 */

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';

let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; results.push(`  PASS  ${name}`); }
  else    { fail++; results.push(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
}

/** Tiny cookie-jar HTTP client. */
function makeClient() {
  const jar = new Map();
  return {
    get cookieHeader() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    async req(path, { method = 'GET', body = null, redirect = 'manual' } = {}) {
      const headers = {};
      if (jar.size) headers.cookie = this.cookieHeader;
      if (body) headers['content-type'] = 'application/x-www-form-urlencoded';

      const res = await fetch(BASE + path, { method, headers, body, redirect });

      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
      const text = await res.text();
      return { status: res.status, location: res.headers.get('location'), text };
    },
  };
}

const tokenOf = (html) => {
  const m = html.match(/name="_csrf"\s+value="([a-f0-9]+)"/);
  return m ? m[1] : null;
};

const form = (obj) => new URLSearchParams(obj).toString();

/** Strip tags and collapse whitespace - markup-shape independent. */
const textOf = (html) =>
  String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** First alert of a given kind, as plain text. */
const alertText = (html, kind = 'error') => {
  const m = String(html).match(
    new RegExp(`class="alert alert--${kind}"[^>]*>([\\s\\S]*?)<\\/div>`)
  );
  return m ? textOf(m[1]) : '';
};

/** Stat tiles as { label: value }, tolerating extra modifier classes. */
const readTiles = (html) =>
  Object.fromEntries(
    [...String(html).matchAll(
      /<div class="stat__label">([\s\S]*?)<\/div>\s*<div class="stat__value[^"]*"[^>]*>([\s\S]*?)<\/div>/g
    )].map((m) => [textOf(m[1]), textOf(m[2])])
  );

async function login(client, { role, username, password }) {
  const page = await client.req('/login');
  const csrf = tokenOf(page.text);
  return client.req('/login', {
    method: 'POST',
    body: form({ _csrf: csrf, role, username, password, next: '' }),
  });
}

/* ====================================================================== */

console.log(`\nSmoke testing ${BASE}\n${'='.repeat(62)}\n`);

/* ---------------------------------------------------------- basic pages */
{
  const c = makeClient();
  const r = await c.req('/login');
  check('GET /login returns 200', r.status === 200, `got ${r.status}`);
  check('login page has a CSRF token', Boolean(tokenOf(r.text)));

  const root = await c.req('/');
  check('GET / redirects to /login when signed out',
        root.status === 302 && root.location === '/login', `${root.status} ${root.location}`);

  const signup = await c.req('/signup');
  check('GET /signup returns 200', signup.status === 200);

  const missing = await c.req('/does-not-exist');
  check('unknown URL returns a styled 404', missing.status === 404);
}

/* ------------------------------------------------------------- student */
{
  const c = makeClient();
  const r = await login(c, { role: '3', username: 'CS2021001', password: 'Pass@123' });
  check('student login succeeds', r.status === 302 && r.location === '/student',
        `${r.status} ${r.location}`);

  const dash = await c.req('/student');
  check('student dashboard loads', dash.status === 200, `got ${dash.status}`);
  check('dashboard shows the student name', dash.text.includes('Aarav'));
  check('dashboard shows an attendance percentage', /\d+\.\d%/.test(dash.text));
  check('dashboard shows the subject breakdown',
        dash.text.includes('Database Management Systems'));

  const marks = await c.req('/student/marks');
  check('student marks page loads', marks.status === 200);
  // State-independent: the graded course must appear with a /out-of figure.
  check('marks page shows a real grade',
        marks.text.includes('Database Management Systems') && /\d+\s*\/\s*50/.test(marks.text));
  // In the PHP version the attendance tiles on this page were never
  // calculated, so they always displayed 0. Read the tiles back properly
  // (a substring match would see the "0.0%" inside "80.0%").
  const tiles = readTiles(marks.text);
  check('marks page shows a real attendance figure, not 0',
        parseFloat(tiles['Attendance']) > 0, `tile read "${tiles['Attendance']}"`);
  check('marks page shows classes attended',
        parseInt(tiles['Classes attended'], 10) > 0, `tile read "${tiles['Classes attended']}"`);
  check('marks page leads with a hero figure',
        /class="hero__value[^"]*">\s*([\d.]+)%/.test(marks.text));

  const forbidden = await c.req('/professor');
  check('student is blocked from /professor', forbidden.status === 403, `got ${forbidden.status}`);
  const forbiddenAdmin = await c.req('/admin');
  check('student is blocked from /admin', forbiddenAdmin.status === 403);
}

/* ----------------------------------------------------------- professor */
{
  const c = makeClient();
  const r = await login(c, { role: '2', username: 'prof_sharma', password: 'Pass@123' });
  check('professor login succeeds', r.status === 302 && r.location === '/professor',
        `${r.status} ${r.location}`);

  const dash = await c.req('/professor');
  check('professor dashboard loads', dash.status === 200);
  check('dashboard lists assigned courses', dash.text.includes('Operating Systems'));

  const select = await c.req('/professor/attendance');
  check('attendance picker loads', select.status === 200);

  const mark = await c.req('/professor/attendance/mark?department_id=1&semester_id=5&course_id=1&date=2025-12-01');
  check('attendance sheet loads', mark.status === 200, `got ${mark.status}`);
  check('attendance sheet lists students', mark.text.includes('CS2021001'));
  check('attendance sheet has bulk actions', mark.text.includes('data-all="Present"'));
  check('attendance sheet has a search box', mark.text.includes('id="search"'));
  check('attendance sheet offers the Late status', mark.text.includes('value="Late"'));

  // Save attendance for 6 students
  const csrf = tokenOf(mark.text);
  const payload = {
    _csrf: csrf, department_id: '1', semester_id: '5', course_id: '1', date: '2025-12-01',
    'status[s1]': 'Present', 'status[s2]': 'Absent', 'status[s3]': 'Late',
    'status[s4]': 'Present', 'status[s5]': 'Present', 'status[s6]': 'Absent',
  };
  const saved = await c.req('/professor/attendance/mark', { method: 'POST', body: form(payload) });
  check('attendance saves', saved.status === 302 && saved.location === '/professor?saved=attendance',
        `${saved.status} ${saved.location}`);

  // Re-submitting the same date must UPDATE, not duplicate.
  const again = await c.req('/professor/attendance/mark?department_id=1&semester_id=5&course_id=1&date=2025-12-01');
  check('re-opening the same date shows it was already marked',
        again.text.includes('already recorded'));
  const csrf2 = tokenOf(again.text);
  const resave = await c.req('/professor/attendance/mark', {
    method: 'POST', body: form({ ...payload, _csrf: csrf2, 'status[s1]': 'Absent' }),
  });
  check('re-saving the same date succeeds', resave.status === 302);

  // Professor must not be able to touch a course they do not teach.
  // prof_sharma teaches courses 1 and 2; course 5 belongs to prof_khan.
  const notMine = await c.req('/professor/attendance/mark?department_id=2&semester_id=5&course_id=5&date=2025-12-01');
  check('professor cannot open a course they do not teach',
        notMine.text.includes('not assigned to that course'), `status ${notMine.status}`);

  const stolen = await c.req('/professor/attendance/mark', {
    method: 'POST',
    body: form({ _csrf: csrf2, department_id: '2', semester_id: '5', course_id: '5',
                 date: '2025-12-01', 'status[s7]': 'Present' }),
  });
  check('professor cannot POST to a course they do not teach', stolen.status === 403,
        `got ${stolen.status}`);

  /* ---- marks ---- */
  const msel = await c.req('/professor/marks');
  check('marks picker loads', msel.status === 200);

  const mentry = await c.req('/professor/marks/entry?department_id=1&semester_id=5&course_id=1');
  check('marks entry loads', mentry.status === 200);
  // Any already-graded student comes back with their mark in the input.
  check('marks entry pre-fills existing marks',
        /class="mark-input"[^>]*value="\d+"/.test(mentry.text) ||
        /value="\d+"[^>]*class="mark-input"/.test(mentry.text));
  // The PHP version shipped professor_id in a hidden input and trusted it.
  check('marks form does NOT contain a professor_id field',
        !/name="professor_id"/.test(mentry.text));

  const mcsrf = tokenOf(mentry.text);
  const msaved = await c.req('/professor/marks/save', {
    method: 'POST',
    body: form({ _csrf: mcsrf, course_id: '1', outof_marks: '50',
                 'marks[s1]': '44', 'marks[s2]': '39' }),
  });
  check('marks save', msaved.status === 302 && msaved.location === '/professor?saved=marks',
        `${msaved.status} ${msaved.location}`);

  const overMax = await c.req('/professor/marks/save', {
    method: 'POST',
    body: form({ _csrf: mcsrf, course_id: '1', outof_marks: '50', 'marks[s1]': '999' }),
  });
  check('marks above the maximum are rejected', overMax.status === 400, `got ${overMax.status}`);
}

/* --------------------------------------------------------------- admin */
{
  const c = makeClient();
  const r = await login(c, { role: '1', username: 'admin1', password: 'Pass@123' });
  check('HoD login succeeds', r.status === 302 && r.location === '/admin',
        `${r.status} ${r.location}`);

  const dash = await c.req('/admin');
  check('admin dashboard loads', dash.status === 200);
  check('admin sees student roll-up', dash.text.includes('CS2021001'));
  check('admin sees professors', dash.text.includes('prof_sharma'));
  check('admin sees courses', dash.text.includes('CS501'));
}

/* ------------------------------------------------------------ security */
{
  // 1. Unauthenticated POST to the route that had NO auth check in PHP.
  const anon = makeClient();
  const open = await anon.req('/login');
  const t = tokenOf(open.text);
  const attempt = await anon.req('/professor/marks/save', {
    method: 'POST',
    body: form({ _csrf: t, course_id: '1', outof_marks: '50', 'marks[s1]': '50' }),
  });
  check('anonymous marks upload is blocked',
        attempt.status === 302 && String(attempt.location).startsWith('/login'),
        `${attempt.status} ${attempt.location}`);

  // 2. CSRF
  const c2 = makeClient();
  await c2.req('/login');
  const noToken = await c2.req('/login', {
    method: 'POST', body: form({ role: '3', username: 'CS2021001', password: 'Pass@123' }),
  });
  check('POST without a CSRF token is rejected', noToken.status === 403, `got ${noToken.status}`);

  // 3. Wrong password
  const c3 = makeClient();
  const bad = await login(c3, { role: '3', username: 'CS2021001', password: 'WrongPass1!' });
  check('wrong password is rejected', bad.status === 401, `got ${bad.status}`);

  // 4. Right password, wrong role
  const c4 = makeClient();
  const wrongRole = await login(c4, { role: '2', username: 'CS2021001', password: 'Pass@123' });
  check('correct password with the wrong role is rejected', wrongRole.status === 401);

  // 5. No username enumeration - identical message either way
  const c5 = makeClient();
  const noUser = await login(c5, { role: '3', username: 'ghost999', password: 'Pass@123' });
  const msgA = alertText(noUser.text, 'error');
  const msgB = alertText(bad.text, 'error');
  check('nonexistent user and wrong password give the SAME message',
        Boolean(msgA) && msgA === msgB, `"${msgA}" vs "${msgB}"`);

  // 6. Session cookie flags
  const c6 = makeClient();
  await login(c6, { role: '3', username: 'CS2021001', password: 'Pass@123' });
  check('session cookie is set', c6.cookieHeader.includes('sams.sid'));

  // 7. Logout
  const after = await c6.req('/logout', {
    method: 'POST', body: form({ _csrf: tokenOf((await c6.req('/student')).text) || '' }),
  });
  check('logout redirects to /login', String(after.location) === '/login', String(after.location));
  const post = await c6.req('/student');
  check('dashboard is inaccessible after logout',
        post.status === 302 && String(post.location).startsWith('/login'),
        `${post.status} ${post.location}`);
}

/* ------------------------------- special-character password round trip */
{
  // The PHP bug: signup hashed the raw password but login HTML-escaped it,
  // so any password containing < > & " ' locked the user out forever.
  const c = makeClient();
  const pageA = await c.req('/signup/student');
  const csrf = tokenOf(pageA.text);
  const uniq = 'TST' + Date.now().toString().slice(-7);
  const pw = 'Pass&12x';   // contains & - allowed by policy, but htmlspecialchars() would mangle it

  const reg = await c.req('/signup/student', {
    method: 'POST',
    body: form({
      _csrf: csrf, first_name: 'Test', last_name: 'User', enrollment_number: uniq,
      email: uniq.toLowerCase() + '@example.com', phone: '9999900000',
      department_id: '1', semester_id: '5', session: '2021-2025',
      password: pw, confirm_password: pw,
    }),
  });
  check('signup with a special-character password succeeds',
        reg.status === 302 && String(reg.location).startsWith('/login'),
        `${reg.status} ${reg.location} ${reg.text.slice(0, 160)}`);

  const c2 = makeClient();
  const back = await login(c2, { role: '3', username: uniq, password: pw });
  check('that same special-character password can LOG IN (PHP bug fixed)',
        back.status === 302 && back.location === '/student', `${back.status} ${back.location}`);
}

/* ---------------------------------------------------------------- done */
console.log(results.join('\n'));
console.log('\n' + '='.repeat(62));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62) + '\n');
process.exit(fail ? 1 : 0);
