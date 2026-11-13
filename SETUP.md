# SAMS — Setup Guide (Node.js + Supabase)

The application has been rebuilt as a **Node.js + Express + PostgreSQL** app.
The original PHP files are still in the repository root for reference but are no
longer used.

> `README.md` still describes the old PHP/MySQL/XAMPP version and is out of date.
> It was left untouched deliberately — replace it when you're ready.

---

## 1. Quick start (no cloud account needed)

You need **Node.js 18+** only. Nothing else — no XAMPP, no PHP, no local Postgres.

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Open **two terminals**:

```bash
# Terminal 1 — local test database
npm run devdb
#   Wait for "Local Postgres ready" before continuing.

# Terminal 2 — the app
npm start
```

Open <http://localhost:3000>.

`npm run devdb` runs **PGlite** — real PostgreSQL compiled to WebAssembly —
and serves it on port 55432 over the normal Postgres wire protocol. The app
uses the exact same driver and SQL it will use against Supabase. Data persists
in `.pgdata/`; delete that folder to reset.

### Demo accounts

All use the password **`Pass@123`**.

| Role | Username |
|------|----------|
| Head of Department | `admin1` |
| Professor | `prof_sharma`, `prof_iyer`, `prof_khan` |
| Student | `CS2021001` … `CS2021006`, `ME2021001`, `EE2021001` |

Student usernames are their enrollment numbers.

---

## 2. Switching to Supabase

1. Create a project at <https://supabase.com>.

2. **Load the schema.** Dashboard → SQL Editor → New query → paste all of
   `schema.sql` → Run. You should end up with 15 tables.

   Or, once `.env` points at Supabase, use the database tools:

   | Command | What it does |
   |---|---|
   | `npm run db:inspect` | Read-only. Lists the tables and row counts. Never prints the password. |
   | `npm run db:init` | First-time load. **Refuses to run if any table exists**, so it cannot destroy data. |
   | `npm run db:push` | Deliberately replaces the schema. Drops every table — asks for confirmation. |
   | `npm run db:clean` | Dry run listing the rows `npm run smoke` created. Add `-- --apply` to remove them. |

   Run `db:inspect` before `db:push`, and prefer `db:init` whenever the
   schema is new.

3. **Get the connection string.** Project Settings → Database → Connection
   string → URI, and pick the **Session pooler** entry:

   ```
   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

   > Use the pooler host, not `db.<ref>.supabase.co`. The direct host is
   > IPv6-only unless you have the IPv4 add-on, which usually fails from a
   > home network.

4. **Update `.env`:**

   ```ini
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATABASE_SSL=true
   SESSION_SECRET=<a long random string>
   ```

   Generate a secret with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. `npm start`. You no longer need `npm run devdb`.

`.env` is git-ignored. Never commit it.

---

## 3. Checking it works

With both the database and app running:

```bash
npm run smoke
```

This drives all three roles through real HTTP requests and asserts that each of
the critical bugs from the PHP version is fixed. Expect **52 passed, 0 failed**.

> The suite **writes real data**: it registers a `TST…` account, marks a class
> on 2025-12-01, and overwrites two mid-sem marks. Against the local PGlite
> database that is harmless — delete `.pgdata/` to reset. Against Supabase,
> run `npm run db:clean` afterwards (dry run), then
> `npm run db:clean -- --apply` to remove them.

---

## 4. Project structure

```
server.js              Express setup, sessions, error handling
schema.sql             PostgreSQL schema + demo data  <- run this in Supabase
.env.example           Configuration template

src/
  config.js            Reads environment variables
  db.js                Connection pool, query helpers, transactions
  middleware/
    auth.js            requireRole() guards, role constants
    csrf.js            CSRF token check on every POST
  routes/
    auth.js            login, logout, signup
    student.js         attendance view, marks view
    professor.js       mark attendance, upload marks
    admin.js           HoD dashboard

views/                 EJS templates
  partials/            shared head + sidebar
public/css/style.css   single shared stylesheet

tools/
  devdb.mjs            local PGlite Postgres server
  push-schema.mjs      apply schema.sql to Supabase
  smoke.mjs            end-to-end test suite
```

---

## 5. What was fixed in the rewrite

**Security**

| Issue in the PHP version | Now |
|---|---|
| `upload_marks.php` had **no login check at all** | Every protected route goes through `requireRole()` |
| `professor_id` sent in a hidden form field and trusted | Always read from the session |
| Raw SQL string concatenation in 3 files | All queries parameterised (`$1`, `$2`) |
| Passwords HTML-escaped at login but not at signup, locking out anyone whose password contained `& < > " '` | Password used exactly as typed |
| CSRF token only on the login form | Enforced on every POST |
| No session regeneration at login | `session.regenerate()` on every login |
| "Invalid password" vs "Invalid username" leaked which accounts exist | One identical message for all failures |
| Raw SQL errors printed to the browser | Logged server-side, friendly page shown |
| DB credentials committed to git | `.env` + `.gitignore` |

**Correctness**

- `login.php` didn't exist, yet 11 files redirected to it → proper `/login` route.
- Attendance submitted lowercase `present`; PostgreSQL enums are case-sensitive
  and would reject it → now `Present` / `Absent` / `Late`.
- Every attendance submission created a **new** `classes` row → now reuses the
  class for that course+date and updates existing records.
- Signups weren't transactional, so a half-failed signup left an orphaned user
  → wrapped in `BEGIN`/`COMMIT`/`ROLLBACK`.
- Student marks page showed "Total Present" and "Total Percentage" that were
  never calculated and always read 0 → now real figures.
- Both admin dashboards hard-coded `department_id = 1` → read from `adminusers`.
- `FILTER_SANITIZE_STRING` (removed in PHP 8.1) → not applicable.

**Interface**

- One shared stylesheet instead of a `<style>` block duplicated in every page,
  with three clashing colour schemes and two fonts. See section 6.
- Genuinely responsive — the sidebar becomes a slide-in drawer on narrow
  screens and tables scroll horizontally. The old dashboards had a fixed
  300px sidebar and no media queries at all.
- Dark mode, a theme toggle, and a real favicon.
- Charts where the README had promised "analytics" and delivered none:
  an attendance trend line, a status split, per-subject meters, and a
  department distribution.
- Attendance marking gained bulk "mark all" actions, a live search box, a live
  tally of the current choices, the `Late` status, and edit-in-place; it no
  longer defaults everyone to Absent.
- Dead buttons ("Notes", "Quiz", "Send Alert", the three unclickable tiles)
  removed rather than left as decoration.

**Two bugs found by screenshotting the result**

- `node-postgres` turns a `DATE` into a JS `Date` at *local* midnight, so
  formatting it back through `toISOString()` shifted every date one day
  earlier in any timezone ahead of UTC — a class held on the 3rd displayed as
  the 2nd. Fixed by parsing `DATE`/`TIMESTAMP` as plain strings (`src/db.js`).
- Express parses `status[12]` as array *index* 12, not a key, which silently
  renumbered every student to 0, 1, 2 and broke the insert against the
  students foreign key. Field names are now `status[s12]`.

---

## 6. The design system

Everything visual is driven by CSS custom properties in
`public/css/style.css`. Change a token there and it propagates everywhere —
there is no second place to edit.

### Colour

Every colour was checked with a contrast and colour-blindness validator
against the actual surface it renders on, not picked by eye.

| Role | Light | Dark | Checked |
|---|---|---|---|
| Brand accent | `#6c5ce7` | `#9282ec` | 4.86:1 / 5.46:1 vs surface |
| Primary ink | `#15161f` | `#ecedf5` | 18.0:1 / 14.8:1 |
| Secondary ink | `#55566b` | `#a9aac0` | 7.17:1 / 7.58:1 |
| Muted ink | `#73748a` | `#8a8b9f` | 4.57:1 / 5.17:1 |

**Two deliberate decisions worth knowing:**

1. **Attendance status never relies on colour alone.** Red vs green measures a
   CVD colour distance of 4.1 (deutan) — far below the safe threshold of 8.
   A red/green-colourblind user genuinely cannot tell Present from Absent by
   hue. So every status carries an **icon and a text label** as well:
   `✓ Present`, `◔ Late`, `✕ Absent`. The amber used for Late also sits at
   1.83:1 on white, below the 3:1 mark floor — the icon and label are what
   make it legible.

2. **Dark mode is a selected palette, not an inversion.** Each step was
   re-chosen and re-validated against the dark surface `#191a23`. It follows
   the OS setting and can be overridden by the toggle in the sidebar, stored
   in `localStorage` and applied before first paint so there is no flash.

### Charts

`src/viz.js` renders charts as server-side SVG — no chart library, no client
bundle. Four components: `meter`, `meterList`, `segmentedBar`, `lineChart`,
`columnChart`.

They follow fixed mark specs: bars capped at 24px with a 4px rounded data-end,
2px lines with round caps, markers at r≥4 with a 2px surface ring, area fills
as a 10% wash, solid hairline gridlines, and a 2px surface gap between
touching segments.

Three rules they stick to:

- **Every chart has a table-view twin.** The "Show data table" toggle under
  each chart gives the same numbers as text, so no value is reachable only by
  hovering.
- **Tooltips enhance, never gate.** Keyboard focus shows exactly what hover
  shows; hit targets are full bands, not pinpoint dots.
- **Never a number on every point.** Only the endpoint and the threshold are
  direct-labelled; the axis and the table carry the rest.

### Form chosen per job

| Screen | Data's job | Form |
|---|---|---|
| Overall attendance | one headline number | hero figure + meter |
| Attendance over time | trend | line chart, single series |
| Present / Late / Absent | one whole, 3 parts | tall segmented bar |
| Per subject, per course, at-risk students | several ratios, each vs its own whole | meter list |
| Students per attendance band | magnitude across ordered bands | column chart, one hue |

Deliberately **not** used: a donut or pie anywhere, a dual-axis chart, or a
colour ramp across nominal categories.

---

## 7. Not done yet

- Notes / assignments / quiz features the old sidebar advertised but never had
- Session storage in Postgres (currently in-memory, so restarting logs everyone out)
- Admin screens to create courses and assign professors to them
  (`professor_courses` is currently seeded by SQL only)
- Rate limiting on the login form
