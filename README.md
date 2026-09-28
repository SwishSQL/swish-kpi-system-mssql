# SWiSH KPI Management System — Microsoft SQL Server edition

Production KPI management for SWiSH: users & permissions, reporting hierarchy, KPI library & assignments, monthly submissions with mandatory evidence attachments, automatic scoring, dashboards, historical reporting, Excel workbook import, audit logs — this edition runs on **Microsoft SQL Server** for self-hosted deployment.

> This is the SQL Server port of `swish-code/swish-kpi-system` (PostgreSQL/Railway). Functionality is identical; see **SQL Server port notes** below for what differs under the hood.

## Stack

- **Next.js 14 (App Router) + TypeScript + Tailwind CSS + Recharts**
- **Prisma ORM + Microsoft SQL Server** (`provider = "sqlserver"`, driver: tedious via Prisma)
- **Zod** validation on every endpoint, permissions enforced **server-side**
- **bcrypt** password hashing, DB-backed sessions in secure HTTP-only cookies
- Attachments in SQL Server by default (`STORAGE_DRIVER=db`) or any S3-compatible bucket (`STORAGE_DRIVER=s3`) — switch via env vars, no code changes

## SQL Server port notes

The application code is unchanged from the PostgreSQL original except where the provider forces a difference:

| Area | PostgreSQL original | This edition |
|---|---|---|
| Enums (`SystemRole`, `SubmissionStatus`, `ApprovalStage`, …) | Native Postgres enums | `String` columns holding the same uppercase values — the TS layer already used string unions |
| `AuditLog.oldValues/newValues`, `ImportJob.errorReport/summary` | `Json` columns | `NVARCHAR(MAX)` JSON text; `logAudit` stringifies, readers parse (`parseJsonColumn`) |
| Case-insensitive search | `mode: 'insensitive'` | Removed — SQL Server's default collation is already case-insensitive |
| `createMany({ skipDuplicates })` | Supported | Not supported on SQL Server — call sites dedupe in code or check per row |
| Cascade deletes | Multiple cascade paths allowed | SQL Server refuses them: `KpiSubmission.employee`, all four `SubmissionApproval` user FKs, the `EmployeeProfile` self-relation and every optional `User` back-reference are `NoAction`; the delete routes handle those children explicitly |
| `EmployeeProfile.userId` unique | Postgres unique (multiple NULLs fine) | Filtered unique index `WHERE userId IS NOT NULL` (SQL Server's plain UNIQUE admits a single NULL) |

**Connection string** (`DATABASE_URL`):

```
sqlserver://HOST:1433;database=swish_kpi;user=USER;password=PASSWORD;encrypt=true;trustServerCertificate=true
```

Drop `trustServerCertificate=true` when the server has a real certificate. For a named instance use `instanceName=SQLEXPRESS` instead of a port.

**First run:**

```bash
npm install
npx prisma migrate deploy   # applies prisma/migrations (SQL Server DDL)
npx tsx prisma/seed.ts      # permissions, roles, initial admin
npm run build && npm start
```

The app listens on **port 6019** — the port assigned to this project on the
company server. It is set with `-p 6019` in the `start`/`serve` scripts rather
than through an environment variable, because `next start` resolves its port
before it loads `.env`, so a `PORT` entry there would be silently ignored. To
run on a different port: `npx next start -p <port>`.

## Core rules

| Rule | Implementation |
|---|---|
| Login username | Work email (unique, lowercased) |
| Initial temporary password | Employee ID — hashed immediately, `mustChangePassword=true`, forced change on first login |
| Percentage KPIs | Stored as points 0–100 (79 → 79%; Excel percent-formatted 0.90 → 90) |
| U scoring (higher better) | `Actual ÷ Target × 100` |
| D scoring (lower better) | `Target ÷ Actual × 100`; `Actual=0` → 100% when `zeroActualIsPerfect` |
| Score cap | 100% default, configurable per KPI |
| Weighted score | `Score × Weight`; weights ≠ 100% flagged |
| Performance status | TARGET_ACHIEVED / BETWEEN_TARGET_AND_THRESHOLD / BELOW_THRESHOLD — separate from submission status |
| Submission | One button per employee; every KPI needs an actual result **and ≥1 attachment**; saved in a single transaction with idempotency key + optimistic versioning |
| Duplicates | One active submission per (assignment, month) — updates never create duplicate rows; identical files rejected by checksum |
| Authority | Role permissions **plus** hierarchy: anyone with reports gets team scope, department managers get department scope, Compliance gets company-wide scope with a department switcher |

## Roles

`SUPER_ADMIN`, `ADMIN`, `COMPLIANCE_SPECIALIST`, `HR_ADMIN`, `EMPLOYEE` — defaults seeded, editable from **Admin → Permissions** (role matrix + per-user overrides, all changes audited).

## Local development

```bash
npm install
cp .env.example .env        # set DATABASE_URL
npx prisma migrate deploy
npm run db:seed             # permissions + initial admin + current month
npm run dev
```

Tests: `npm test` (scoring, hierarchy, permissions). Typecheck: `npm run typecheck`.

## Railway deployment

1. Push this repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo**.
3. Add a **PostgreSQL** service; reference its `DATABASE_URL` in the app service.
4. Set variables (see `.env.example`): `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `INITIAL_ADMIN_EMPLOYEE_ID`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`.
5. Deploy — `railway.json` runs `npm run build`, then `prisma migrate deploy && seed && next start`, health-checked at `/api/health`.
6. Generate a domain, open it, sign in with the initial admin email; the temporary password is the admin Employee ID; you will be forced to set a new password.
7. (Optional) Attachments to a bucket: create a Railway Storage Bucket / S3 / R2, set `STORAGE_DRIVER=s3` + `STORAGE_*` vars. Without it files persist inside PostgreSQL (survives restarts/redeploys).

## First-time setup after deploy

1. **Admin → Import**: upload the Excel workbook. The wizard detects sheets, suggests type + column mapping per sheet, previews rows, validates, and imports in dependency order (Departments → Employees → KPI Library → Assignments → Submissions). Failed rows never block valid ones; download the error report per sheet.
2. Every imported employee gets a login: **email = work email, temporary password = Employee ID** (forced change on first login). Rows with missing/duplicate/invalid email are reported as blocking errors unless you tick *allow profiles without email*.
3. **Admin → Hierarchy**: review the tree, fix employees without managers, assign Department Managers. Self-reporting and circular structures are rejected; cross-department reporting requires an explicit override.
4. **Admin → Periods**: the current month is opened by the seed; set the deadline/grace period.

## Environment variables

See [.env.example](.env.example). `SESSION_SECRET`/`ENCRYPTION_KEY` should be long random strings. `MAX_FILE_SIZE_MB` (default 10) and `MAX_FILES_PER_KPI` (default 5) control attachment limits.

## Role guides

See [docs/GUIDES.md](docs/GUIDES.md) for the Admin, Compliance Specialist, Manager and Employee walkthroughs.

## Security

bcrypt(12) hashing · rate-limited login with account lockout (5 attempts / 15 min) · session revocation on deactivate/reset · CSRF header + SameSite cookies · Zod validation · server-side permission checks on every endpoint · attachment MIME/extension/size validation with executable rejection + SHA-256 checksums · authorized download endpoints (no public URLs) · security headers · full audit log (logins, permission/hierarchy/KPI/submission/period changes, imports, exports).
