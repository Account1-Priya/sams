import express from 'express';
import { query, queryOne } from '../db.js';
import { requireRole, ROLES } from '../middleware/auth.js';

export const adminRouter = express.Router();

adminRouter.use(requireRole(ROLES.ADMIN));

/**
 * The HoD dashboard.
 *
 * dashboard_admin.php and hod_dashboard.php were near-identical copies that
 * BOTH hard-coded `$department_id = 1`, so every admin saw the CSE department
 * regardless of who they were. The department now comes from the adminusers
 * row for the logged-in account.
 */
adminRouter.get('/', async (req, res, next) => {
  try {
    const admin = await queryOne(
      `SELECT au.department_id, d.department_name
         FROM adminusers au
    LEFT JOIN departments d ON d.department_id = au.department_id
        WHERE au.user_id = $1`,
      [req.session.user.id]
    );

    if (!admin) {
      return res.status(404).render('error', {
        title: 'Profile missing', status: 404,
        message: 'Your login exists but no administrator profile is linked to it.',
      });
    }

    const departmentId = admin.department_id;

    const counts = await queryOne(
      `SELECT (SELECT COUNT(*) FROM students   WHERE department_id = $1)::int AS students,
              (SELECT COUNT(*) FROM professors WHERE department_id = $1)::int AS professors,
              (SELECT COUNT(*) FROM courses    WHERE department_id = $1)::int AS courses`,
      [departmentId]
    );

    const attendanceSummary = await queryOne(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
         FROM attendance a
         JOIN students s ON s.student_id = a.student_id
        WHERE s.department_id = $1`,
      [departmentId]
    );

    const courses = await query(
      `SELECT c.course_name, c.course_code, c.credit_hours,
              COALESCE(string_agg(p.first_name || ' ' || p.last_name, ', '
                       ORDER BY p.first_name), '-') AS taught_by
         FROM courses c
    LEFT JOIN professor_courses pc ON pc.course_id = c.course_id
    LEFT JOIN professors p         ON p.professor_id = pc.professor_id
        WHERE c.department_id = $1
        GROUP BY c.course_id, c.course_name, c.course_code, c.credit_hours
        ORDER BY c.course_code`,
      [departmentId]
    );

    // Per-student attendance rather than one undifferentiated row-per-record
    // table, which grew without limit in the PHP version.
    const students = await query(
      `SELECT s.student_id, s.first_name, s.last_name, s.enrollment_no,
              sem.semester_name,
              COUNT(a.attendance_id)::int AS total,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late'))::int AS attended
         FROM students s
    LEFT JOIN semesters sem ON sem.semester_id = s.semester_id
    LEFT JOIN attendance a  ON a.student_id = s.student_id
        WHERE s.department_id = $1
        GROUP BY s.student_id, s.first_name, s.last_name, s.enrollment_no, sem.semester_name
        ORDER BY s.enrollment_no`,
      [departmentId]
    );

    const professors = await query(
      `SELECT p.first_name, p.last_name, p.username, p.email,
              COUNT(pc.course_id)::int AS course_count
         FROM professors p
    LEFT JOIN professor_courses pc ON pc.professor_id = p.professor_id
        WHERE p.department_id = $1
        GROUP BY p.professor_id, p.first_name, p.last_name, p.username, p.email
        ORDER BY p.first_name`,
      [departmentId]
    );

    // Distribution of students across attendance bands. The bands are ordered,
    // but a value-ramp would just re-encode bar height, so they share one hue;
    // the band that matters (under 75%) is called out in the at-risk list.
    const withRecords = students.filter((s) => s.total > 0);
    const bands = [
      { label: '0-39%',   min: 0,  max: 40 },
      { label: '40-59%',  min: 40, max: 60 },
      { label: '60-74%',  min: 60, max: 75 },
      { label: '75-89%',  min: 75, max: 90 },
      { label: '90-100%', min: 90, max: 101 },
    ].map((b) => ({
      label: b.label,
      value: withRecords.filter((s) => {
        const p = (s.attended / s.total) * 100;
        return p >= b.min && p < b.max;
      }).length,
    }));

    const atRisk = withRecords
      .map((s) => ({ ...s, pct: (s.attended / s.total) * 100 }))
      .filter((s) => s.pct < 75)
      .sort((a, b) => a.pct - b.pct);

    res.render('admin/dashboard', {
      title: 'Head of Department dashboard',
      admin, counts, attendanceSummary, courses, students, professors,
      bands, atRisk, trackedCount: withRecords.length,
      active: 'home',
    });
  } catch (err) { next(err); }
});
