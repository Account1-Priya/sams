import express from 'express';
import { query, queryOne, withTransaction } from '../db.js';
import { requireRole, ROLES } from '../middleware/auth.js';
import { asDate, shortDate, longDate, today } from '../dates.js';

export const professorRouter = express.Router();

professorRouter.use(requireRole(ROLES.PROFESSOR));

const STATUSES = ['Present', 'Absent', 'Late'];

/**
 * Turn a posted map like { s12: 'Present', s13: 'Absent' } into
 * [[12, 'Present'], [13, 'Absent']].
 *
 * The "s" prefix matters: Express parses bodies with `qs`, and a field named
 * `status[12]` is treated as ARRAY INDEX 12, not a key. That silently
 * renumbered every student to 0, 1, 2 ... and the insert then failed against
 * the students foreign key. Prefixing keeps it an object.
 */
function parseIdMap(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .map(([k, v]) => [Number(String(k).replace(/^s/, '')), v])
    .filter(([id]) => Number.isInteger(id) && id > 0);
}

/**
 * The professor is ALWAYS derived from the session.
 *
 * The PHP flow put professor_id in a hidden form field and upload_marks.php
 * trusted whatever came back, so anyone could submit marks as any professor.
 */
async function currentProfessor(req) {
  return queryOne(
    `SELECT p.professor_id, p.first_name, p.last_name, p.username,
            p.department_id, d.department_name
       FROM professorusers pu
       JOIN professors p    ON p.professor_id = pu.professor_id
  LEFT JOIN departments d   ON d.department_id = p.department_id
      WHERE pu.user_id = $1`,
    [req.session.user.id]
  );
}

/** Courses this professor is actually assigned to teach. */
async function coursesFor(professorId) {
  return query(
    `SELECT c.course_id, c.course_name, c.course_code
       FROM professor_courses pc
       JOIN courses c ON c.course_id = pc.course_id
      WHERE pc.professor_id = $1
      ORDER BY c.course_name`,
    [professorId]
  );
}

/** Guard: confirm this professor may touch this course at all. */
async function assertTeaches(professorId, courseId) {
  const row = await queryOne(
    'SELECT 1 FROM professor_courses WHERE professor_id = $1 AND course_id = $2',
    [professorId, courseId]
  );
  return Boolean(row);
}

async function professorOr404(req, res) {
  const prof = await currentProfessor(req);
  if (!prof) {
    res.status(404).render('error', {
      title: 'Profile missing', status: 404,
      message: 'Your login exists but no professor profile is linked to it.',
    });
    return null;
  }
  return prof;
}

/* -------------------------------------------------------------- dashboard */

professorRouter.get('/', async (req, res, next) => {
  try {
    const prof = await professorOr404(req, res);
    if (!prof) return;

    const courses = await coursesFor(prof.professor_id);

    const summary = await queryOne(
      `SELECT COUNT(DISTINCT cl.class_id)::int AS classes_held,
              COUNT(a.attendance_id)::int      AS records,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
         FROM classes cl
    LEFT JOIN attendance a ON a.class_id = cl.class_id
        WHERE cl.professor_id = $1`,
      [prof.professor_id]
    );

    const recent = await query(
      `SELECT cl.class_id, cl.class_schedule, c.course_name, c.course_code,
              COUNT(a.attendance_id)::int AS marked,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
         FROM classes cl
         JOIN courses c    ON c.course_id = cl.course_id
    LEFT JOIN attendance a ON a.class_id = cl.class_id
        WHERE cl.professor_id = $1
        GROUP BY cl.class_id, cl.class_schedule, c.course_name, c.course_code
        ORDER BY cl.class_schedule DESC
        LIMIT 8`,
      [prof.professor_id]
    );

    // Turnout per class day, oldest first - the trend line reads left to right.
    const trendRows = await query(
      `SELECT cl.class_schedule::date AS day,
              COUNT(a.attendance_id)::int AS marked,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
         FROM classes cl
    LEFT JOIN attendance a ON a.class_id = cl.class_id
        WHERE cl.professor_id = $1
        GROUP BY cl.class_schedule::date
       HAVING COUNT(a.attendance_id) > 0
        ORDER BY cl.class_schedule::date
        LIMIT 30`,
      [prof.professor_id]
    );
    const trend = trendRows.map((r) => {
      const iso = asDate(r.day);
      return {
        label: shortDate(iso),
        full: longDate(iso),
        value: r.marked ? (r.attended / r.marked) * 100 : 0,
      };
    });

    // Turnout per course - several ratios, one per named row.
    const byCourse = await query(
      `SELECT c.course_name, c.course_code,
              COUNT(a.attendance_id)::int AS marked,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
         FROM professor_courses pc
         JOIN courses c       ON c.course_id = pc.course_id
    LEFT JOIN classes cl      ON cl.course_id = c.course_id AND cl.professor_id = pc.professor_id
    LEFT JOIN attendance a    ON a.class_id = cl.class_id
        WHERE pc.professor_id = $1
        GROUP BY c.course_id, c.course_name, c.course_code
        ORDER BY c.course_name`,
      [prof.professor_id]
    );

    res.render('professor/dashboard', {
      title: 'Professor dashboard',
      prof, courses, summary, recent, trend, byCourse,
      saved: req.query.saved ?? null,
      active: 'home',
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------ mark attendance (1) */

professorRouter.get('/attendance', async (req, res, next) => {
  try {
    const prof = await professorOr404(req, res);
    if (!prof) return;

    res.render('professor/attendance-select', {
      title: 'Mark attendance',
      prof,
      error: null,
      courses: await coursesFor(prof.professor_id),
      departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
      semesters: await query('SELECT semester_id, semester_name FROM semesters ORDER BY semester_id'),
      values: {},
      active: 'attendance',
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------ mark attendance (2) */

professorRouter.get('/attendance/mark', async (req, res, next) => {
  try {
    const prof = await professorOr404(req, res);
    if (!prof) return;

    const departmentId = Number(req.query.department_id);
    const semesterId = Number(req.query.semester_id);
    const courseId = Number(req.query.course_id);
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const rerenderSelect = async (error) =>
      res.status(400).render('professor/attendance-select', {
        title: 'Mark attendance', prof, error,
        courses: await coursesFor(prof.professor_id),
        departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
        semesters: await query('SELECT semester_id, semester_name FROM semesters ORDER BY semester_id'),
        values: req.query,
        active: 'attendance',
      });

    if (!departmentId || !semesterId || !courseId) {
      return rerenderSelect('Please choose a department, semester and course.');
    }
    if (!(await assertTeaches(prof.professor_id, courseId))) {
      return rerenderSelect('You are not assigned to that course.');
    }

    const students = await query(
      `SELECT student_id, first_name, last_name, enrollment_no
         FROM students
        WHERE department_id = $1 AND semester_id = $2
        ORDER BY enrollment_no`,
      [departmentId, semesterId]
    );

    // If attendance for this course+date already exists, pre-select it so the
    // professor is editing rather than silently creating a duplicate class.
    const existing = await query(
      `SELECT a.student_id, a.status
         FROM attendance a
         JOIN classes cl ON cl.class_id = a.class_id
        WHERE cl.course_id = $1 AND cl.professor_id = $2
          AND a.attendance_date = $3`,
      [courseId, prof.professor_id, date]
    );
    const existingMap = Object.fromEntries(existing.map((r) => [r.student_id, r.status]));

    const course = await queryOne(
      'SELECT course_name, course_code FROM courses WHERE course_id = $1', [courseId]
    );

    res.render('professor/attendance-mark', {
      title: 'Mark attendance',
      prof, students, course, date,
      departmentId, semesterId, courseId,
      existingMap,
      alreadyMarked: existing.length > 0,
      statuses: STATUSES,
      active: 'attendance',
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------ mark attendance (3) */

professorRouter.post('/attendance/mark', async (req, res, next) => {
  try {
    const prof = await professorOr404(req, res);
    if (!prof) return;

    const departmentId = Number(req.body.department_id);
    const semesterId = Number(req.body.semester_id);
    const courseId = Number(req.body.course_id);
    const date = String(req.body.date || '').slice(0, 10);
    const statuses = req.body.status ?? {};

    if (!departmentId || !semesterId || !courseId || !date) {
      return res.status(400).render('error', {
        title: 'Incomplete submission', status: 400,
        message: 'Some attendance details were missing. Please start again.',
      });
    }
    if (!(await assertTeaches(prof.professor_id, courseId))) {
      return res.status(403).render('error', {
        title: 'Not your course', status: 403,
        message: 'You are not assigned to that course, so you cannot mark its attendance.',
      });
    }

    const entries = parseIdMap(statuses);
    if (entries.length === 0) {
      return res.redirect(
        `/professor/attendance/mark?department_id=${departmentId}` +
        `&semester_id=${semesterId}&course_id=${courseId}&date=${date}`
      );
    }
    // Capitalised values only - Postgres enums are case-sensitive, unlike MySQL.
    for (const [, v] of entries) {
      if (!STATUSES.includes(v)) {
        return res.status(400).render('error', {
          title: 'Invalid status', status: 400,
          message: `"${v}" is not a valid attendance status.`,
        });
      }
    }

    await withTransaction(async (client) => {
      // Reuse the class for this course+professor+date instead of inserting a
      // brand new one on every submit, which is what bloated the old classes
      // table and produced duplicate attendance rows.
      const { rows: found } = await client.query(
        `SELECT class_id FROM classes
          WHERE course_id = $1 AND professor_id = $2
            AND class_schedule::date = $3::date
          LIMIT 1`,
        [courseId, prof.professor_id, date]
      );

      let classId = found[0]?.class_id;
      if (!classId) {
        const { rows: [created] } = await client.query(
          `INSERT INTO classes (course_id, professor_id, semester_id, class_schedule, department_id)
           VALUES ($1, $2, $3, $4::date + NOW()::time, $5) RETURNING class_id`,
          [courseId, prof.professor_id, semesterId, date, departmentId]
        );
        classId = created.class_id;
      }

      for (const [studentId, status] of entries) {
        await client.query(
          `INSERT INTO attendance (student_id, class_id, attendance_date, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (student_id, class_id)
           DO UPDATE SET status = EXCLUDED.status, attendance_date = EXCLUDED.attendance_date`,
          [studentId, classId, date, status]
        );
      }
    });

    res.redirect('/professor?saved=attendance');
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ marks (1) */

professorRouter.get('/marks', async (req, res, next) => {
  try {
    const prof = await professorOr404(req, res);
    if (!prof) return;

    res.render('professor/marks-select', {
      title: 'Upload mid-sem marks',
      prof,
      error: null,
      courses: await coursesFor(prof.professor_id),
      departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
      semesters: await query('SELECT semester_id, semester_name FROM semesters ORDER BY semester_id'),
      values: {},
      active: 'marks',
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ marks (2) */

professorRouter.get('/marks/entry', async (req, res, next) => {
  try {
    const prof = await professorOr404(req, res);
    if (!prof) return;

    const departmentId = Number(req.query.department_id);
    const semesterId = Number(req.query.semester_id);
    const courseId = Number(req.query.course_id);

    const rerenderSelect = async (error) =>
      res.status(400).render('professor/marks-select', {
        title: 'Upload mid-sem marks', prof, error,
        courses: await coursesFor(prof.professor_id),
        departments: await query('SELECT department_id, department_name FROM departments ORDER BY department_name'),
        semesters: await query('SELECT semester_id, semester_name FROM semesters ORDER BY semester_id'),
        values: req.query,
        active: 'marks',
      });

    if (!departmentId || !semesterId || !courseId) {
      return rerenderSelect('Please choose a department, semester and course.');
    }
    if (!(await assertTeaches(prof.professor_id, courseId))) {
      return rerenderSelect('You are not assigned to that course.');
    }

    const students = await query(
      `SELECT s.student_id, s.first_name, s.last_name, s.enrollment_no,
              m.marks_obtained, m.outof_marks
         FROM students s
    LEFT JOIN midsem_marks m
           ON m.student_id = s.student_id AND m.course_id = $3
        WHERE s.department_id = $1 AND s.semester_id = $2
        ORDER BY s.enrollment_no`,
      [departmentId, semesterId, courseId]
    );

    const course = await queryOne(
      'SELECT course_name, course_code FROM courses WHERE course_id = $1', [courseId]
    );

    res.render('professor/marks-entry', {
      title: 'Upload mid-sem marks',
      prof, students, course,
      departmentId, semesterId, courseId,
      defaultOutOf: students.find((s) => s.outof_marks)?.outof_marks ?? 50,
      active: 'marks',
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ marks (3) */

professorRouter.post('/marks/save', async (req, res, next) => {
  try {
    // This is the route that had NO authentication at all in the PHP version.
    const prof = await professorOr404(req, res);
    if (!prof) return;

    const courseId = Number(req.body.course_id);
    const outOf = Number(req.body.outof_marks);
    const marks = req.body.marks ?? {};

    if (!courseId || !Number.isFinite(outOf) || outOf <= 0) {
      return res.status(400).render('error', {
        title: 'Invalid submission', status: 400,
        message: 'Please provide a valid "out of" total.',
      });
    }
    if (!(await assertTeaches(prof.professor_id, courseId))) {
      return res.status(403).render('error', {
        title: 'Not your course', status: 403,
        message: 'You are not assigned to that course, so you cannot upload its marks.',
      });
    }

    const entries = parseIdMap(marks).filter(([, v]) => String(v).trim() !== '');
    for (const [, v] of entries) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > outOf) {
        return res.status(400).render('error', {
          title: 'Invalid marks', status: 400,
          message: `Every mark must be a number between 0 and ${outOf}.`,
        });
      }
    }

    await withTransaction(async (client) => {
      for (const [studentId, value] of entries) {
        await client.query(
          `INSERT INTO midsem_marks
             (student_id, course_id, professor_id, marks_obtained, outof_marks, upload_date)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (student_id, course_id)
           DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained,
                         outof_marks    = EXCLUDED.outof_marks,
                         professor_id   = EXCLUDED.professor_id,
                         upload_date    = NOW()`,
          [studentId, courseId, prof.professor_id, Number(value), outOf]
        );
      }
    });

    res.redirect('/professor?saved=marks');
  } catch (err) { next(err); }
});
