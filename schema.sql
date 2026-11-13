-- ============================================================================
--  SAMS - Student Attendance Management System
--  PostgreSQL / Supabase schema
-- ============================================================================
--  Reconstructed from the application source code (every SELECT and INSERT in
--  the 19 PHP files was mapped to produce this file). The original sams.sql
--  referenced in README.md was never committed to the repository.
--
--  HOW TO USE
--    1. Supabase Dashboard -> SQL Editor -> New query
--    2. Paste this entire file and press "Run"
--    3. Verify: Table Editor should show 15 tables
--
--  DEMO LOGIN (all seeded accounts share one password)
--    Password : Pass@123
--    HOD      : admin1
--    Professor: prof_sharma / prof_iyer / prof_khan
--    Student  : CS2021001 ... CS2021006, ME2021001, EE2021001
--
--  NOTE: student usernames are intentionally identical to their
--  enrollment_no, because dashboard_std.php looks a student up with
--  "WHERE enrollment_no = <session username>". They must also be strictly
--  alphanumeric (no slashes or dashes), because dashboard_std.php rejects
--  anything that fails the pattern ^[a-zA-Z0-9_]+$
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Clean slate (safe to re-run)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS auditlogs         CASCADE;
DROP TABLE IF EXISTS midsem_marks      CASCADE;
DROP TABLE IF EXISTS attendance        CASCADE;
DROP TABLE IF EXISTS classes           CASCADE;
DROP TABLE IF EXISTS professor_courses CASCADE;
DROP TABLE IF EXISTS courses           CASCADE;
DROP TABLE IF EXISTS adminusers        CASCADE;
DROP TABLE IF EXISTS professorusers    CASCADE;
DROP TABLE IF EXISTS studentusers      CASCADE;
DROP TABLE IF EXISTS professors        CASCADE;
DROP TABLE IF EXISTS students          CASCADE;
DROP TABLE IF EXISTS users             CASCADE;
DROP TABLE IF EXISTS semesters         CASCADE;
DROP TABLE IF EXISTS departments       CASCADE;
DROP TABLE IF EXISTS roles             CASCADE;
DROP TYPE  IF EXISTS attendance_status CASCADE;


-- ---------------------------------------------------------------------------
-- Enum: attendance status
-- ---------------------------------------------------------------------------
--  IMPORTANT: PostgreSQL enums are CASE-SENSITIVE, unlike the MySQL ENUM type.
--  attendance_list.php currently submits lowercase 'present' / 'absent',
--  which MySQL silently auto-corrected to 'Present' / 'Absent'. Postgres will
--  REJECT the lowercase values. The radio button values in attendance_list.php
--  must be changed to 'Present' / 'Absent' (and 'Late' added) before marking
--  attendance will work.
CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Late');


-- ---------------------------------------------------------------------------
-- Lookup tables
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
    role_id    SERIAL PRIMARY KEY,
    role_name  VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE departments (
    department_id    SERIAL PRIMARY KEY,
    department_name  VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE semesters (
    semester_id    SERIAL PRIMARY KEY,
    semester_name  VARCHAR(100) NOT NULL,
    start_date     DATE,
    end_date       DATE
);


-- ---------------------------------------------------------------------------
-- users - the single credential store for every role
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    username       VARCHAR(100) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,   -- PHP password_hash(), bcrypt
    email          VARCHAR(100) UNIQUE,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    role_id        INTEGER REFERENCES roles(role_id)
);


-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
CREATE TABLE students (
    student_id     SERIAL PRIMARY KEY,
    first_name     VARCHAR(100) NOT NULL,
    last_name      VARCHAR(100),
    enrollment_no  VARCHAR(50) NOT NULL UNIQUE,
    email          VARCHAR(100),
    phone          VARCHAR(15),
    department_id  INTEGER REFERENCES departments(department_id),
    semester_id    INTEGER REFERENCES semesters(semester_id),
    session        VARCHAR(50)      -- academic year, e.g. 2021-2025
);

CREATE TABLE professors (
    professor_id   SERIAL PRIMARY KEY,
    first_name     VARCHAR(100) NOT NULL,
    last_name      VARCHAR(100),
    username       VARCHAR(100) NOT NULL UNIQUE,
    email          VARCHAR(100),
    phone          VARCHAR(15),
    department_id  INTEGER REFERENCES departments(department_id)
);


-- ---------------------------------------------------------------------------
-- Role bridge tables - login checks these to confirm the chosen role
-- ---------------------------------------------------------------------------
CREATE TABLE studentusers (
    student_user_id  SERIAL PRIMARY KEY,
    student_id       INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    user_id          INTEGER NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
    UNIQUE (user_id)
);

CREATE TABLE professorusers (
    professor_user_id  SERIAL PRIMARY KEY,
    professor_id       INTEGER NOT NULL REFERENCES professors(professor_id) ON DELETE CASCADE,
    user_id            INTEGER NOT NULL REFERENCES users(user_id)           ON DELETE CASCADE,
    username           VARCHAR(100),   -- denormalised; signUpProf.php inserts it
    UNIQUE (user_id)
);

CREATE TABLE adminusers (
    admin_user_id  SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    department_id  INTEGER REFERENCES departments(department_id),
    UNIQUE (user_id)
);


-- ---------------------------------------------------------------------------
-- Academic structure
-- ---------------------------------------------------------------------------
CREATE TABLE courses (
    course_id      SERIAL PRIMARY KEY,
    course_name    VARCHAR(100) NOT NULL,
    course_code    VARCHAR(50) NOT NULL UNIQUE,
    credit_hours   INTEGER,
    department_id  INTEGER REFERENCES departments(department_id)
);

-- which professor teaches which course
CREATE TABLE professor_courses (
    professor_course_id  SERIAL PRIMARY KEY,
    professor_id         INTEGER NOT NULL REFERENCES professors(professor_id) ON DELETE CASCADE,
    course_id            INTEGER NOT NULL REFERENCES courses(course_id)       ON DELETE CASCADE,
    UNIQUE (professor_id, course_id)
);

-- one row per lecture session actually held
CREATE TABLE classes (
    class_id        SERIAL PRIMARY KEY,
    course_id       INTEGER REFERENCES courses(course_id),
    professor_id    INTEGER REFERENCES professors(professor_id),
    semester_id     INTEGER REFERENCES semesters(semester_id),
    class_schedule  TIMESTAMP,
    department_id   INTEGER REFERENCES departments(department_id)
);


-- ---------------------------------------------------------------------------
-- Records
-- ---------------------------------------------------------------------------
CREATE TABLE attendance (
    attendance_id    SERIAL PRIMARY KEY,
    student_id       INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    class_id         INTEGER NOT NULL REFERENCES classes(class_id)    ON DELETE CASCADE,
    attendance_date  DATE NOT NULL,
    status           attendance_status NOT NULL,
    -- stops the same student being marked twice for the same class
    UNIQUE (student_id, class_id)
);

CREATE TABLE midsem_marks (
    mark_id         SERIAL PRIMARY KEY,
    student_id      INTEGER NOT NULL REFERENCES students(student_id)   ON DELETE CASCADE,
    course_id       INTEGER NOT NULL REFERENCES courses(course_id)     ON DELETE CASCADE,
    professor_id    INTEGER NOT NULL REFERENCES professors(professor_id),
    marks_obtained  INTEGER NOT NULL CHECK (marks_obtained >= 0),
    outof_marks     INTEGER NOT NULL CHECK (outof_marks   >  0),
    upload_date     TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (marks_obtained <= outof_marks),
    -- one mark per student per course
    UNIQUE (student_id, course_id)
);

CREATE TABLE auditlogs (
    log_id      SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    login_time  TIMESTAMP NOT NULL DEFAULT NOW(),
    ip_address  VARCHAR(45)
);


-- ---------------------------------------------------------------------------
-- Indexes for the lookups the app performs on every page load
-- ---------------------------------------------------------------------------
CREATE INDEX idx_students_dept_sem   ON students(department_id, semester_id);
CREATE INDEX idx_students_enrollment ON students(enrollment_no);
CREATE INDEX idx_attendance_student  ON attendance(student_id);
CREATE INDEX idx_attendance_date     ON attendance(attendance_date);
CREATE INDEX idx_classes_course      ON classes(course_id);
CREATE INDEX idx_midsem_student      ON midsem_marks(student_id);
CREATE INDEX idx_profcourses_prof    ON professor_courses(professor_id);


-- ============================================================================
--  SEED DATA
-- ============================================================================
--  Every account below uses the password:  Pass@123
--  (bcrypt hashes generated with PHP password_hash with PASSWORD_DEFAULT)
-- ============================================================================

INSERT INTO roles (role_id, role_name) VALUES
    (1, 'Admin'),
    (2, 'Professor'),
    (3, 'Student');

INSERT INTO departments (department_id, department_name) VALUES
    (1, 'Computer Science & Engineering'),
    (2, 'Mechanical Engineering'),
    (3, 'Electrical Engineering'),
    (4, 'Civil Engineering'),
    (5, 'Electronics & Communication');

INSERT INTO semesters (semester_id, semester_name, start_date, end_date) VALUES
    (1, 'Semester 1', '2021-08-01', '2021-12-20'),
    (2, 'Semester 2', '2022-01-10', '2022-05-30'),
    (3, 'Semester 3', '2022-08-01', '2022-12-20'),
    (4, 'Semester 4', '2023-01-10', '2023-05-30'),
    (5, 'Semester 5', '2023-08-01', '2023-12-20'),
    (6, 'Semester 6', '2024-01-10', '2024-05-30'),
    (7, 'Semester 7', '2024-08-01', '2024-12-20'),
    (8, 'Semester 8', '2025-01-10', '2025-05-30');

-- --- users -----------------------------------------------------------------
INSERT INTO users (user_id, username, password_hash, email, role_id) VALUES
    (1, 'admin1',      '$2y$10$OZD7hscchbCi.HtVOsu7i.MefwxT9uXw2gArfPNEe.9qfKNtMYlq.', 'hod.cse@college.edu',  1),
    (2, 'prof_sharma', '$2y$10$Gr.7hL9TWUbWYBfexhRXoONZpeW6By1IPNnT97H43BBPJ4n/BXK7O', 'r.sharma@college.edu', 2),
    (3, 'prof_iyer',   '$2y$10$rLFyi870MyF5Iwm1ueGFeO4qyrB3m34oKl6z8C.jEZGjP.elPXpcK', 'm.iyer@college.edu',   2),
    (4, 'prof_khan',   '$2y$10$OZD7hscchbCi.HtVOsu7i.MefwxT9uXw2gArfPNEe.9qfKNtMYlq.', 'a.khan@college.edu',   2),
    (5, 'CS2021001',   '$2y$10$Gr.7hL9TWUbWYBfexhRXoONZpeW6By1IPNnT97H43BBPJ4n/BXK7O', 'aarav.s@college.edu',  3),
    (6, 'CS2021002',   '$2y$10$rLFyi870MyF5Iwm1ueGFeO4qyrB3m34oKl6z8C.jEZGjP.elPXpcK', 'isha.p@college.edu',   3),
    (7, 'CS2021003',   '$2y$10$OZD7hscchbCi.HtVOsu7i.MefwxT9uXw2gArfPNEe.9qfKNtMYlq.', 'ananya.d@college.edu', 3),
    (8, 'CS2021004',   '$2y$10$Gr.7hL9TWUbWYBfexhRXoONZpeW6By1IPNnT97H43BBPJ4n/BXK7O', 'rohan.m@college.edu',  3),
    (9, 'CS2021005',   '$2y$10$rLFyi870MyF5Iwm1ueGFeO4qyrB3m34oKl6z8C.jEZGjP.elPXpcK', 'sneha.k@college.edu',  3),
    (10,'CS2021006',   '$2y$10$OZD7hscchbCi.HtVOsu7i.MefwxT9uXw2gArfPNEe.9qfKNtMYlq.', 'vikram.n@college.edu', 3),
    (11,'ME2021001',   '$2y$10$Gr.7hL9TWUbWYBfexhRXoONZpeW6By1IPNnT97H43BBPJ4n/BXK7O', 'raj.v@college.edu',    3),
    (12,'EE2021001',   '$2y$10$rLFyi870MyF5Iwm1ueGFeO4qyrB3m34oKl6z8C.jEZGjP.elPXpcK', 'priya.r@college.edu',  3);

-- --- professors ------------------------------------------------------------
INSERT INTO professors (professor_id, first_name, last_name, username, email, phone, department_id) VALUES
    (1, 'Rakesh', 'Sharma', 'prof_sharma', 'r.sharma@college.edu', '9876500001', 1),
    (2, 'Meena',  'Iyer',   'prof_iyer',   'm.iyer@college.edu',   '9876500002', 1),
    (3, 'Arif',   'Khan',   'prof_khan',   'a.khan@college.edu',   '9876500003', 2);

-- --- students --------------------------------------------------------------
INSERT INTO students (student_id, first_name, last_name, enrollment_no, email, phone, department_id, semester_id, session) VALUES
    (1, 'Aarav',  'Sharma', 'CS2021001', 'aarav.s@college.edu',  '9876510001', 1, 5, '2021-2025'),
    (2, 'Isha',   'Patel',  'CS2021002', 'isha.p@college.edu',   '9876510002', 1, 5, '2021-2025'),
    (3, 'Ananya', 'Desai',  'CS2021003', 'ananya.d@college.edu', '9876510003', 1, 5, '2021-2025'),
    (4, 'Rohan',  'Mehta',  'CS2021004', 'rohan.m@college.edu',  '9876510004', 1, 5, '2021-2025'),
    (5, 'Sneha',  'Kapoor', 'CS2021005', 'sneha.k@college.edu',  '9876510005', 1, 5, '2021-2025'),
    (6, 'Vikram', 'Nair',   'CS2021006', 'vikram.n@college.edu', '9876510006', 1, 5, '2021-2025'),
    (7, 'Raj',    'Verma',  'ME2021001', 'raj.v@college.edu',    '9876510007', 2, 5, '2021-2025'),
    (8, 'Priya',  'Rao',    'EE2021001', 'priya.r@college.edu',  '9876510008', 3, 5, '2021-2025');

-- --- role bridges ----------------------------------------------------------
INSERT INTO adminusers (user_id, department_id) VALUES (1, 1);

INSERT INTO professorusers (professor_id, user_id, username) VALUES
    (1, 2, 'prof_sharma'),
    (2, 3, 'prof_iyer'),
    (3, 4, 'prof_khan');

INSERT INTO studentusers (student_id, user_id) VALUES
    (1, 5), (2, 6), (3, 7), (4, 8), (5, 9), (6, 10), (7, 11), (8, 12);

-- --- courses ---------------------------------------------------------------
INSERT INTO courses (course_id, course_name, course_code, credit_hours, department_id) VALUES
    (1, 'Database Management Systems', 'CS501', 4, 1),
    (2, 'Operating Systems',           'CS502', 4, 1),
    (3, 'Computer Networks',           'CS503', 3, 1),
    (4, 'Software Engineering',        'CS504', 3, 1),
    (5, 'Thermodynamics',              'ME501', 4, 2),
    (6, 'Power Systems',               'EE501', 4, 3);

INSERT INTO professor_courses (professor_id, course_id) VALUES
    (1, 1), (1, 2),
    (2, 3), (2, 4),
    (3, 5);

-- --- classes held ----------------------------------------------------------
INSERT INTO classes (class_id, course_id, professor_id, semester_id, class_schedule, department_id) VALUES
(1, 1, 1, 5, '2025-11-03 09:00:00', 1),
    (2, 2, 1, 5, '2025-11-04 11:00:00', 1),
    (3, 3, 2, 5, '2025-11-05 09:00:00', 1),
    (4, 1, 1, 5, '2025-11-10 11:00:00', 1),
    (5, 2, 1, 5, '2025-11-11 09:00:00', 1),
    (6, 3, 2, 5, '2025-11-12 11:00:00', 1),
    (7, 1, 1, 5, '2025-11-17 09:00:00', 1),
    (8, 4, 2, 5, '2025-11-18 11:00:00', 1),
    (9, 1, 1, 5, '2025-11-24 09:00:00', 1),
    (10, 2, 1, 5, '2025-11-25 11:00:00', 1);

-- --- attendance ------------------------------------------------------------
INSERT INTO attendance (student_id, class_id, attendance_date, status) VALUES
(1, 1, '2025-11-03', 'Present'),
    (1, 2, '2025-11-04', 'Present'),
    (1, 3, '2025-11-05', 'Present'),
    (1, 4, '2025-11-10', 'Late'),
    (1, 5, '2025-11-11', 'Present'),
    (1, 6, '2025-11-12', 'Present'),
    (1, 7, '2025-11-17', 'Absent'),
    (1, 8, '2025-11-18', 'Present'),
    (1, 9, '2025-11-24', 'Present'),
    (1, 10, '2025-11-25', 'Present'),
    (2, 1, '2025-11-03', 'Present'),
    (2, 2, '2025-11-04', 'Absent'),
    (2, 3, '2025-11-05', 'Present'),
    (2, 4, '2025-11-10', 'Absent'),
    (2, 5, '2025-11-11', 'Present'),
    (2, 6, '2025-11-12', 'Late'),
    (2, 7, '2025-11-17', 'Present'),
    (2, 8, '2025-11-18', 'Absent'),
    (2, 9, '2025-11-24', 'Present'),
    (2, 10, '2025-11-25', 'Present'),
    (3, 1, '2025-11-03', 'Present'),
    (3, 2, '2025-11-04', 'Present'),
    (3, 3, '2025-11-05', 'Present'),
    (3, 4, '2025-11-10', 'Present'),
    (3, 5, '2025-11-11', 'Present'),
    (3, 6, '2025-11-12', 'Late'),
    (3, 7, '2025-11-17', 'Present'),
    (3, 8, '2025-11-18', 'Present'),
    (3, 9, '2025-11-24', 'Present'),
    (3, 10, '2025-11-25', 'Present'),
    (4, 1, '2025-11-03', 'Absent'),
    (4, 2, '2025-11-04', 'Absent'),
    (4, 3, '2025-11-05', 'Present'),
    (4, 4, '2025-11-10', 'Absent'),
    (4, 5, '2025-11-11', 'Present'),
    (4, 6, '2025-11-12', 'Absent'),
    (4, 7, '2025-11-17', 'Present'),
    (4, 8, '2025-11-18', 'Absent'),
    (4, 9, '2025-11-24', 'Present'),
    (4, 10, '2025-11-25', 'Late'),
    (5, 1, '2025-11-03', 'Present'),
    (5, 2, '2025-11-04', 'Present'),
    (5, 3, '2025-11-05', 'Present'),
    (5, 4, '2025-11-10', 'Present'),
    (5, 5, '2025-11-11', 'Present'),
    (5, 6, '2025-11-12', 'Present'),
    (5, 7, '2025-11-17', 'Present'),
    (5, 8, '2025-11-18', 'Present'),
    (5, 9, '2025-11-24', 'Present'),
    (5, 10, '2025-11-25', 'Present'),
    (6, 1, '2025-11-03', 'Present'),
    (6, 2, '2025-11-04', 'Present'),
    (6, 3, '2025-11-05', 'Absent'),
    (6, 4, '2025-11-10', 'Late'),
    (6, 5, '2025-11-11', 'Present'),
    (6, 6, '2025-11-12', 'Absent'),
    (6, 7, '2025-11-17', 'Present'),
    (6, 8, '2025-11-18', 'Present'),
    (6, 9, '2025-11-24', 'Late'),
    (6, 10, '2025-11-25', 'Present');

-- --- midsem marks ----------------------------------------------------------
INSERT INTO midsem_marks (student_id, course_id, professor_id, marks_obtained, outof_marks, upload_date) VALUES
    (1, 1, 1, 42, 50, '2025-10-15 14:30:00'),
    (2, 1, 1, 31, 50, '2025-10-15 14:30:00'),
    (3, 1, 1, 47, 50, '2025-10-15 14:30:00'),
    (4, 1, 1, 19, 50, '2025-10-15 14:30:00'),
    (5, 1, 1, 45, 50, '2025-10-15 14:30:00'),
    (6, 1, 1, 36, 50, '2025-10-15 14:30:00'),

    (1, 2, 1, 40, 50, '2025-10-16 11:00:00'),
    (2, 2, 1, 27, 50, '2025-10-16 11:00:00'),
    (3, 2, 1, 44, 50, '2025-10-16 11:00:00'),
    (4, 2, 1, 22, 50, '2025-10-16 11:00:00'),
    (5, 2, 1, 48, 50, '2025-10-16 11:00:00'),
    (6, 2, 1, 33, 50, '2025-10-16 11:00:00'),

    (1, 3, 2, 31, 40, '2025-10-18 10:00:00'),
    (2, 3, 2, 24, 40, '2025-10-18 10:00:00'),
    (3, 3, 2, 37, 40, '2025-10-18 10:00:00'),
    (5, 3, 2, 35, 40, '2025-10-18 10:00:00'),
    (6, 3, 2, 26, 40, '2025-10-18 10:00:00'),

    (1, 4, 2, 15, 25, '2025-10-21 09:30:00'),
    (3, 4, 2, 23, 25, '2025-10-21 09:30:00'),
    (5, 4, 2, 21, 25, '2025-10-21 09:30:00');


-- ---------------------------------------------------------------------------
-- Keep SERIAL counters in step with the explicit IDs inserted above
-- ---------------------------------------------------------------------------
SELECT setval('roles_role_id_seq',             (SELECT MAX(role_id)       FROM roles));
SELECT setval('departments_department_id_seq', (SELECT MAX(department_id) FROM departments));
SELECT setval('semesters_semester_id_seq',     (SELECT MAX(semester_id)   FROM semesters));
SELECT setval('users_user_id_seq',             (SELECT MAX(user_id)       FROM users));
SELECT setval('students_student_id_seq',       (SELECT MAX(student_id)    FROM students));
SELECT setval('professors_professor_id_seq',   (SELECT MAX(professor_id)  FROM professors));
SELECT setval('courses_course_id_seq',         (SELECT MAX(course_id)     FROM courses));
SELECT setval('classes_class_id_seq',          (SELECT MAX(class_id)      FROM classes));


-- ---------------------------------------------------------------------------
-- Row Level Security (optional)
-- ---------------------------------------------------------------------------
--  The PHP app connects straight to Postgres as the postgres role, which
--  BYPASSES RLS - so you do not need this for the app to work, and Supabase
--  will simply show an "RLS disabled" advisory in the dashboard.
--  Only enable RLS if you later expose these tables through the Supabase REST
--  API (PostgREST) with the anon key. If you do, you must add policies too,
--  otherwise every API read returns zero rows.
--
--  ALTER TABLE students   ENABLE ROW LEVEL SECURITY;
--  ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
--  ... plus CREATE POLICY statements for each table.
