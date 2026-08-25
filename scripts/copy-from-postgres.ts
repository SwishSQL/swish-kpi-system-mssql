/**
 * One-shot data copy: Railway PostgreSQL -> this project's SQL Server database.
 *
 *   npx tsx scripts/copy-from-postgres.ts --source "postgresql://..." --yes
 *
 * The target database is WIPED first, then every table is copied in
 * foreign-key order. Re-running is safe (it wipes again), so a failed run can
 * simply be repeated.
 *
 * Reading uses `pg` with plain SQL rather than a second Prisma client: two
 * Prisma clients for two providers cannot coexist in one process without a
 * separate generated output, and the read side needs nothing clever.
 *
 * Conversions applied on the way across (see prisma/schema.prisma):
 *   - Json columns (AuditLog.oldValues/newValues, ImportJob.errorReport/
 *     summary) become JSON text, because SQL Server has no Json type.
 *   - Enum columns arrive from Postgres as strings and land in String
 *     columns unchanged.
 *   - Bytes (Attachment.data) travels as a Buffer.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';

// Run directly with tsx, so nothing has loaded .env for us (same as the seed).
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const mm = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (mm && process.env[mm[1]] === undefined) process.env[mm[1]] = mm[2];
    }
  }
}

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const SOURCE_URL = arg('source') || process.env.SOURCE_DATABASE_URL;
const CONFIRMED = args.includes('--yes');

if (!SOURCE_URL) {
  console.error('Missing --source "postgresql://..." (or SOURCE_DATABASE_URL).');
  process.exit(1);
}

const target = new PrismaClient();
const source = new Client({ connectionString: SOURCE_URL });

/**
 * Tables in dependency order: a table only appears after everything it points
 * at. `json` lists columns that must be stringified for SQL Server, `batch` is
 * tuned per table because SQL Server caps a statement at 2100 parameters and
 * the attachment rows carry hundreds of KB of binary each.
 */
const TABLES: { name: string; model: string; batch: number; page?: number; json?: string[] }[] = [
  { name: 'User', model: 'user', batch: 60 },
  { name: 'Permission', model: 'permission', batch: 200 },
  { name: 'Department', model: 'department', batch: 200 },
  { name: 'EmployeeProfile', model: 'employeeProfile', batch: 80 },
  { name: 'Session', model: 'session', batch: 150 },
  { name: 'RolePermission', model: 'rolePermission', batch: 300 },
  { name: 'UserPermissionOverride', model: 'userPermissionOverride', batch: 300 },
  { name: 'Kpi', model: 'kpi', batch: 50 },
  { name: 'KpiAssignment', model: 'kpiAssignment', batch: 80 },
  { name: 'SubmissionPeriod', model: 'submissionPeriod', batch: 100 },
  { name: 'KpiSubmission', model: 'kpiSubmission', batch: 60 },
  { name: 'SubmissionApproval', model: 'submissionApproval', batch: 60 },
  { name: 'ApprovalEvent', model: 'approvalEvent', batch: 150 },
  // Binary payloads - a handful at a time keeps memory and packet size sane.
  { name: 'Attachment', model: 'attachment', batch: 5, page: 10 },
  { name: 'AuditLog', model: 'auditLog', batch: 80, json: ['oldValues', 'newValues'] },
  { name: 'ImportJob', model: 'importJob', batch: 60, json: ['errorReport', 'summary'] },
  { name: 'Notification', model: 'notification', batch: 120 },
  { name: 'SystemSetting', model: 'systemSetting', batch: 200 },
];

function m(model: string): any {
  return (target as any)[model];
}

async function wipeTarget() {
  console.log('\n== Clearing the target database ==');
  // The self-referencing manager column would block the delete row by row.
  await target.employeeProfile.updateMany({ data: { directManagerEmployeeId: null } });
  for (const t of [...TABLES].reverse()) {
    const removed = await m(t.model).deleteMany({});
    if (removed.count) console.log(`  ${t.name}: removed ${removed.count}`);
  }
}

async function copyTable(t: { name: string; model: string; batch: number; page?: number; json?: string[] }) {
  const { rows: countRows } = await source.query(`SELECT COUNT(*)::int AS n FROM "${t.name}"`);
  const total: number = countRows[0].n;
  if (total === 0) {
    console.log(`  ${t.name}: empty`);
    return 0;
  }

  let copied = 0;
  let offset = 0;
  const page = t.page ?? Math.max(t.batch, 200);

  while (offset < total) {
    const { rows } = await source.query(
      `SELECT * FROM "${t.name}" ORDER BY 1 OFFSET $1 LIMIT $2`,
      [offset, page]
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      // Json -> text, and the manager link is deferred until every profile exists.
      for (const col of t.json ?? []) {
        if (row[col] !== null && row[col] !== undefined && typeof row[col] !== 'string') {
          row[col] = JSON.stringify(row[col]);
        }
      }
      if (t.name === 'EmployeeProfile') row.directManagerEmployeeId = null;
    }

    for (let i = 0; i < rows.length; i += t.batch) {
      const chunk = rows.slice(i, i + t.batch);
      await m(t.model).createMany({ data: chunk });
      copied += chunk.length;
    }
    offset += rows.length;
    process.stdout.write(`\r  ${t.name}: ${copied}/${total}`);
  }
  process.stdout.write(`\r  ${t.name}: ${copied}/${total}\n`);
  return copied;
}

async function restoreManagers() {
  const { rows } = await source.query(
    `SELECT id, "directManagerEmployeeId" FROM "EmployeeProfile" WHERE "directManagerEmployeeId" IS NOT NULL`
  );
  let done = 0;
  for (const r of rows) {
    await target.employeeProfile.update({
      where: { id: r.id },
      data: { directManagerEmployeeId: r.directManagerEmployeeId },
    });
    done++;
    if (done % 50 === 0) process.stdout.write(`\r  reporting lines: ${done}/${rows.length}`);
  }
  process.stdout.write(`\r  reporting lines: ${done}/${rows.length}\n`);
}

async function verify() {
  console.log('\n== Verifying row counts ==');
  let mismatch = 0;
  for (const t of TABLES) {
    const { rows } = await source.query(`SELECT COUNT(*)::int AS n FROM "${t.name}"`);
    const src: number = rows[0].n;
    const dst: number = await m(t.model).count();
    const ok = src === dst;
    if (!ok) mismatch++;
    console.log(`  ${ok ? 'OK  ' : 'DIFF'} ${t.name}: source ${src} / target ${dst}`);
  }
  return mismatch;
}

(async () => {
  await source.connect();
  console.log('Connected to the source (PostgreSQL).');
  await target.$connect();
  console.log('Connected to the target (SQL Server).');

  if (!CONFIRMED) {
    console.log('\nThis will DELETE everything currently in the SQL Server database and');
    console.log('replace it with a copy of the PostgreSQL data.');
    console.log('Re-run with --yes to proceed.');
    await source.end();
    await target.$disconnect();
    process.exit(0);
  }

  const started = Date.now();
  await wipeTarget();

  console.log('\n== Copying ==');
  for (const t of TABLES) await copyTable(t);

  console.log('\n== Restoring the reporting hierarchy ==');
  await restoreManagers();

  const mismatch = await verify();
  const mins = ((Date.now() - started) / 60000).toFixed(1);

  await source.end();
  await target.$disconnect();

  if (mismatch > 0) {
    console.log(`\nFinished in ${mins} min with ${mismatch} table(s) not matching - see above.`);
    process.exit(1);
  }
  console.log(`\nDone in ${mins} min. Every table matches the source.`);
})().catch(async (err) => {
  console.error('\nCopy failed:', err?.message || err);
  try { await source.end(); } catch {}
  try { await target.$disconnect(); } catch {}
  process.exit(1);
});
