import express from 'express';
import { query, queryOne } from '../db.js';
import { requireRole, ROLES } from '../middleware/auth.js';
import { asDate, shortDate, longDate, today } from '../dates.js';

export const studentRouter = express.Router();

/** True only for a real "YYYY-MM-DD" calendar date. */
function isIsoDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''))) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Running attendance percentage over time.
 *
 * Day-by-day rates bounce between 0 and 100 on a light timetable and read as
 * noise; the cumulative rate is what a student is actually judged on, and it
 * is what the 75% threshold line refers to.
 */
async function attendanceTrend(studentId) {
  const days = await query(
    `SELECT a.attendance_date AS day,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
       FROM attendance a
      WHERE a.student_id = $1
      GROUP BY a.attendance_date
      ORDER BY a.attendance_date`,
    [studentId]
  );

  let runTotal = 0, runAttended = 0;
  return days.map((d) => {
    runTotal += d.total;
    runAttended += d.attended;
    const iso = asDate(d.day);
    return {
      label: shortDate(iso),
      full: longDate(iso),
      value: runTotal ? (runAttended / runTotal) * 100 : 0,
    };
  });
}

studentRouter.use(requireRole(ROLES.STUDENT));

/**
 * Resolve the logged-in student from the SESSION USER ID.
 *
 * The PHP pages matched `students.enrollment_no` against the session username,
 * which only worked by convention. Going through studentusers is the
 * relationship the schema actually models.
 */
async function currentStudent(req) {
  return queryOne(
    `SELECT s.student_id, s.first_name, s.last_name, s.enrollment_no,
            s.department_id, s.semester_id, s.session,
            d.department_name, sem.semester_name
       FROM studentusers su
       JOIN students s      ON s.student_id = su.student_id
  LEFT JOIN departments d   ON d.department_id = s.department_id
  LEFT JOIN semesters sem   ON sem.semester_id = s.semester_id
      WHERE su.user_id = $1`,
    [req.session.user.id]
  );
}

/** Overall attendance figures, used by both student pages. */
async function attendanceStats(studentId) {
  const row = await queryOne(
    `SELECT COUNT(*)::int                                            AS total,
            COUNT(*) FILTER (WHERE status = 'Present')::int          AS present,
            COUNT(*) FILTER (WHERE status = 'Late')::int             AS late,
            COUNT(*) FILTER (WHERE status = 'Absent')::int           AS absent
       FROM attendance WHERE student_id = $1`,
    [studentId]
  );
  const total = row?.total ?? 0;
  const present = row?.present ?? 0;
  const late = row?.late ?? 0;
  // "Late" still counts as having attended.
  const attended = present + late;
  return {
    total,
    present,
    late,
    absent: row?.absent ?? 0,
    attended,
    percentage: total > 0 ? (attended / total) * 100 : 0,
  };
}

/* ------------------------------------------------- attendance (dashboard) */

studentRouter.get('/', async (req, res, next) => {
  try {
    const student = await currentStudent(req);
    if (!student) {
      return res.status(404).render('error', {
        title: 'Profile missing', status: 404,
        message: 'Your login exists but no student profile is linked to it. Contact your administrator.',
      });
    }

    const filter = req.query.filter === 'date' ? 'date' : 'all';
    // The value goes into a DATE comparison, so anything that is not a real
    // ISO date has to be rejected here. Passing it through produced a 500
    // ("invalid input syntax for type date") from a hand-edited URL, and
    // Postgres also quietly accepts words like "tomorrow", which would show
    // the student a day they never asked for.
    const date = isIsoDate(req.query.date) ? req.query.date : today();

    const rows = filter === 'date'
      ? await query(
          `SELECT c.course_name, c.course_code, a.attendance_date, a.status
             FROM attendance a
             JOIN classes cl ON cl.class_id = a.class_id
             JOIN courses c  ON c.course_id = cl.course_id
            WHERE a.student_id = $1 AND a.attendance_date = $2
            ORDER BY a.attendance_date DESC, c.course_name`,
          [student.student_id, date]
        )
      : await query(
          `SELECT c.course_name, c.course_code, a.attendance_date, a.status
             FROM attendance a
             JOIN classes cl ON cl.class_id = a.class_id
             JOIN courses c  ON c.course_id = cl.course_id
            WHERE a.student_id = $1
            ORDER BY a.attendance_date DESC, c.course_name`,
          [student.student_id]
        );

    // Group by date for display
    const grouped = new Map();
    for (const r of rows) {
      const key = r.attendance_date instanceof Date
        ? r.attendance_date.toISOString().slice(0, 10)
        : String(r.attendance_date).slice(0, 10);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    }

    // Per-subject breakdown
    const bySubject = await query(
      `SELECT c.course_name, c.course_code,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
         FROM attendance a
         JOIN classes cl ON cl.class_id = a.class_id
         JOIN courses c  ON c.course_id = cl.course_id
        WHERE a.student_id = $1
        GROUP BY c.course_name, c.course_code
        ORDER BY c.course_name`,
      [student.student_id]
    );

    res.render('student/dashboard', {
      title: 'My attendance',
      student,
      stats: await attendanceStats(student.student_id),
      trend: await attendanceTrend(student.student_id),
      grouped: [...grouped.entries()],
      bySubject,
      filter,
      date,
      active: 'attendance',
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ midsem marks */

studentRouter.get('/marks', async (req, res, next) => {
  try {
    const student = await currentStudent(req);
    if (!student) {
      return res.status(404).render('error', {
        title: 'Profile missing', status: 404,
        message: 'Your login exists but no student profile is linked to it.',
      });
    }

    const marks = await query(
      `SELECT m.marks_obtained, m.outof_marks, m.upload_date,
              c.course_name, c.course_code,
              p.first_name AS prof_first, p.last_name AS prof_last
         FROM midsem_marks m
         JOIN courses c    ON c.course_id = m.course_id
         JOIN professors p ON p.professor_id = m.professor_id
        WHERE m.student_id = $1
        ORDER BY m.upload_date DESC`,
      [student.student_id]
    );

    const totalObtained = marks.reduce((s, m) => s + Number(m.marks_obtained), 0);
    const totalOutOf = marks.reduce((s, m) => s + Number(m.outof_marks), 0);

    res.render('student/marks', {
      title: 'Mid-semester marks',
      student,
      // The PHP page showed these two figures but never calculated them,
      // so they were permanently stuck at 0.
      stats: await attendanceStats(student.student_id),
      marks,
      totalObtained,
      totalOutOf,
      overallPct: totalOutOf > 0 ? (totalObtained / totalOutOf) * 100 : 0,
      active: 'marks',
    });
  } catch (err) { next(err); }
});
