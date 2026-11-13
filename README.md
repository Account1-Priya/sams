# Student Attendance Management System (SAMS)

## Overview
Student Attendance Management System (SAMS) is a web-based application designed to streamline and simplify the process of managing student attendance. Developed as a minor project for our college, SAMS aims to provide an intuitive, efficient, and user-friendly solution for teachers and administrators to track and analyze student attendance.

## Key Features
- **Role-Based Login System**: Secure access for students, professors, and administrators.
- **Attendance Recording**: Easy recording of daily attendance with just a few clicks.
- **Attendance Reports**: Generate detailed attendance reports for individual students or entire classes.
- **Student Dashboard**: Students can view their attendance records and overall statistics.
- **Responsive Design**: Accessible on both desktops and mobile devices.
- **Secure Data Management**: Utilizes encrypted passwords and secure database connections.

## Technologies Used
- **Frontend**: EJS templates, CSS, JavaScript (no frontend framework)
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Supabase in production, PGlite for local development)
- **Charts**: hand-rolled inline SVG (`src/viz.js`) — no charting library

## Team Members
1. **Anurag Kumar**
2. **Priya Singh**
3. **Priya Yadav**
4. **Pradeep Kumar Maurya**

## Installation Guide
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/your-repo/sams.git
   cd sams
   npm install
   ```
2. Copy `.env.example` to `.env` and fill it in.
3. Start the local test database in a second terminal:
   ```bash
   npm run devdb
   ```
4. Load the schema, then start the app:
   ```bash
   npm run db:init
   npm start
   ```
5. Open http://localhost:3000

See [SETUP.md](SETUP.md) for the full walkthrough, including Supabase setup.

## Usage Instructions
1. **Admin Login**:
   - Admin can manage students, professors, and attendance records.
2. **Professor Login**:
   - Professors can mark attendance, view class attendance reports, upload notes/assignment, etc.
3. **Student Login**:
   - Students can view their attendance history, midsem marks, notes, quiz and analytics, etc.

## Screenshots
![image](https://github.com/user-attachments/assets/18b54765-9ab0-4b31-94c4-1f5d7809a4a4)
![image](https://github.com/user-attachments/assets/046414eb-63bc-4679-8254-086d89361ad8)

## Future Enhancements
- Integration with email notifications for attendance alerts.
- Advanced analytics and insights for attendance trends.
- Integration with mobile applications for better accessibility.
- Facial recognition for automated attendance marking.

## Acknowledgments
We would like to express our gratitude to our mentors and faculty members for their guidance and support throughout the development of this project. Special thanks to our college for providing us with the opportunity to work on this project.

---

Developed with dedication by Team SAMS:
- Anurag Kumar
- Priya Singh
- Priya Yadav
- Pradeep Kumar Maurya

