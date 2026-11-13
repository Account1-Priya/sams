/**
 * Remove the data that `npm run smoke` writes, so a real database goes back
 * to pristine demo state.
 *
 *   npm run db:clean          dry run - lists what WOULD be removed
 *   npm run db:clean -- --apply   actually removes it
 *
 * Deliberately narrow: it only matches the smoke suite's own signature
 * (TST-prefixed accounts, its fixed class date, and the two marks it
 * overwrites). It will not touch real attendance you have recorded.
 */
import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

// The exact signature of what tools/smoke.mjs creates.
const TEST_PREFIX = 'TST';
const TEST_CLASS_DATE = '2025-12-01';
// (student_id, course_id) -> seeded marks_obtained that smoke.mjs overwrites
const SEED_MARKS = [[1, 1, 42], [2, 1, 31]];

const ssl = (process.env.DATABASE_SSL ?? 'true').toLowerCase() === 'true'
  ? { rejectUnauthorized: false } : false;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl });

let where = 'unknown';
try {
  const u = new URL(process.env.DATABASE_URL);
  where = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch { /* ignore */ }

await client.connect();
console.log(`\n  Target : ${where}`);
console.log(`  Mode   : ${APPLY ? 'APPLY - rows will be deleted' : 'DRY RUN - nothing will change'}\n`);

const preview = async (label, sql, params = []) => {
  const { rows } = await client.query(sql, params);
  console.log(`  ${label}: ${rows.length}`);
  rows.forEach((r) => console.log(`      ${JSON.stringify(r)}`));
  return rows;
};

const users = await preview('test accounts',
  `SELECT user_id, username FROM users WHERE username LIKE $1 ORDER BY user_id`, [TEST_PREFIX + '%']);
const studs = await preview('test student rows',
  `SELECT student_id, enrollment_no FROM students WHERE enrollment_no LIKE $1 ORDER BY student_id`, [TEST_PREFIX + '%']);
const cls = await preview('test classes',
  `SELECT class_id, class_schedule::date AS day FROM classes
    WHERE class_schedule::date = $1::date ORDER BY class_id`, [TEST_CLASS_DATE]);
const att = await preview('attendance on those classes',
  `SELECT COUNT(*)::int AS rows FROM attendance a JOIN classes c ON c.class_id = a.class_id
    WHERE c.class_schedule::date = $1::date`, [TEST_CLASS_DATE]);
console.log(`  marks to restore: ${SEED_MARKS.length}`);
SEED_MARKS.forEach(([s, c, m]) => console.log(`      student ${s}, course ${c} -> ${m}`));

if (!APPLY) {
  console.log('\n  Dry run only. Re-run with --apply to remove these.\n');
  await client.end();
  process.exit(0);
}

try {
  await client.query('BEGIN');

  const { rowCount: aDel } = await client.query(
    `DELETE FROM attendance a USING classes c
      WHERE c.class_id = a.class_id AND c.class_schedule::date = $1::date`, [TEST_CLASS_DATE]);
  const { rowCount: cDel } = await client.query(
    `DELETE FROM classes WHERE class_schedule::date = $1::date`, [TEST_CLASS_DATE]);
  const { rowCount: suDel } = await client.query(
    `DELETE FROM studentusers su USING students s
      WHERE s.student_id = su.student_id AND s.enrollment_no LIKE $1`, [TEST_PREFIX + '%']);
  const { rowCount: sDel } = await client.query(
    `DELETE FROM students WHERE enrollment_no LIKE $1`, [TEST_PREFIX + '%']);
  const { rowCount: uDel } = await client.query(
    `DELETE FROM users WHERE username LIKE $1`, [TEST_PREFIX + '%']);

  let mFix = 0;
  for (const [s, c, m] of SEED_MARKS) {
    const r = await client.query(
      `UPDATE midsem_marks SET marks_obtained = $3
        WHERE student_id = $1 AND course_id = $2 AND marks_obtained <> $3`, [s, c, m]);
    mFix += r.rowCount;
  }

  await client.query('COMMIT');
  console.log(`\n  Removed: ${aDel} attendance, ${cDel} class(es), ` +
              `${suDel} link(s), ${sDel} student(s), ${uDel} user(s)`);
  console.log(`  Restored: ${mFix} mark(s) to their seeded values\n`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error(`\n  FAILED (rolled back): ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
