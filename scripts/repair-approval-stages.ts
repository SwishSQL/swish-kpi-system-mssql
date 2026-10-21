/**
 * One-off repair: employee-months whose stage is ahead of their own KPIs.
 *
 *   npx tsx scripts/repair-approval-stages.ts            # dry run - changes nothing
 *   npx tsx scripts/repair-approval-stages.ts --apply    # writes a backup, then repairs
 *
 * Why it exists: submitting stamped the month with the stage the chain should
 * enter at (a manager who keys numbers in has already reviewed them, so their
 * own level is skipped) but left every KPI row on its default
 * PENDING_LINE_MANAGER. The month then said "Awaiting compliance" while each
 * KPI said "Awaiting line manager", and the month-level Approve button needed
 * two clicks. The submit route is fixed; this repairs the months already
 * affected.
 *
 * What it does: for each unapproved month, any submitted KPI whose stage is
 * BEHIND the month's stage is raised to the month's stage. It never lowers a
 * stage, never touches APPROVED/LOCKED rows or drafts, and never edits the
 * month itself - the month already holds the stage that was intended.
 *
 * --apply first saves every old value to scripts/approval-stage-repair-<time>.json
 * so the change can be reversed, and writes one audit entry per month.
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const mm = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (mm && process.env[mm[1]] === undefined) process.env[mm[1]] = mm[2];
    }
  }
}

const ORDER = ['PENDING_LINE_MANAGER', 'PENDING_DEPARTMENT_MANAGER', 'PENDING_COMPLIANCE', 'APPROVED'];
const rank = (s: string) => ORDER.indexOf(s);
const APPLY = process.argv.includes('--apply');
const db = new PrismaClient();

(async () => {
  const months = await db.submissionApproval.findMany({
    where: { stage: { not: 'APPROVED' } },
    select: { id: true, employeeProfileId: true, submissionMonth: true, stage: true },
  });

  const plan: { approvalId: string; month: string; monthStage: string; rows: { id: string; from: string }[] }[] = [];
  for (const m of months) {
    const rows = await db.kpiSubmission.findMany({
      where: { employeeProfileId: m.employeeProfileId, submissionMonth: m.submissionMonth, submissionStatus: { not: 'DRAFT' } },
      select: { id: true, stage: true },
    });
    const behind = rows.filter((r) => rank(r.stage) < rank(m.stage));
    if (behind.length) plan.push({ approvalId: m.id, month: m.submissionMonth, monthStage: m.stage, rows: behind.map((r) => ({ id: r.id, from: r.stage })) });
  }

  const rowCount = plan.reduce((s, p) => s + p.rows.length, 0);
  const byMonthStage: Record<string, number> = {};
  for (const p of plan) byMonthStage[p.monthStage] = (byMonthStage[p.monthStage] ?? 0) + 1;
  console.log(`Unapproved months checked : ${months.length}`);
  console.log(`Months needing repair     : ${plan.length}  ${JSON.stringify(byMonthStage)}`);
  console.log(`KPI rows to raise         : ${rowCount}`);

  if (!APPLY) {
    console.log('\nDry run - nothing was changed. Re-run with --apply to repair.');
    return;
  }
  if (!plan.length) return;

  const backup = path.join(__dirname, `approval-stage-repair-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(plan, null, 1));
  console.log(`\nBackup written: ${backup}`);

  for (const p of plan) {
    await db.$transaction(async (tx) => {
      for (const r of p.rows) {
        await tx.kpiSubmission.update({ where: { id: r.id }, data: { stage: p.monthStage as any } });
      }
      await tx.auditLog.create({
        data: {
          action: 'APPROVAL_STAGE_REPAIRED',
          entityType: 'SubmissionApproval',
          entityId: p.approvalId,
          // SQL Server has no Json type - the audit log stores JSON text.
          oldValues: JSON.stringify({ kpiStages: p.rows.map((r) => r.from), month: p.month }),
          newValues: JSON.stringify({ kpiStage: p.monthStage, rows: p.rows.length }),
        },
      });
    });
  }
  console.log(`Repaired ${plan.length} months (${rowCount} KPI rows).`);
})()
  .catch((e) => { console.error('FAILED:', e?.message || e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
