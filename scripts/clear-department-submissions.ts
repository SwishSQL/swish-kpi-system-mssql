/**
 * Deletes every recorded submission for one department, in this project's
 * database.
 *
 *   npx tsx scripts/clear-department-submissions.ts --department "CPU - Bakery"
 *   npx tsx scripts/clear-department-submissions.ts --department "CPU - Bakery" --yes
 *
 * Without --yes it only reports what would go. With --yes it deletes the
 * submissions and the approval records for that department's employees;
 * attachments and approval events follow by cascade.
 *
 * The KPI assignments are left alone - the people keep their KPIs, they simply
 * have no results recorded any more, so the months show as Not started.
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

const db = new PrismaClient();
const args = process.argv.slice(2);
const i = args.indexOf('--department');
const DEPARTMENT = i >= 0 ? args[i + 1] : undefined;
const CONFIRMED = args.includes('--yes');

if (!DEPARTMENT) {
  console.error('Missing --department "<name>".');
  process.exit(1);
}

(async () => {
  const dept = await db.department.findFirst({ where: { name: DEPARTMENT } });
  if (!dept) {
    const all = await db.department.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    console.error(`No department called "${DEPARTMENT}". Known names:\n  ${all.map((d) => d.name).join('\n  ')}`);
    process.exit(1);
  }

  const emps = await db.employeeProfile.findMany({
    where: { departmentId: dept.id },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);

  const submissions = await db.kpiSubmission.findMany({
    where: { employeeProfileId: { in: ids } },
    select: { id: true, submissionMonth: true, employeeProfileId: true },
  });
  const approvals = await db.submissionApproval.findMany({
    where: { employeeProfileId: { in: ids } },
    select: { stage: true, submissionMonth: true },
  });
  const attachments = await db.attachment.count({
    where: { submissionId: { in: submissions.map((s) => s.id) } },
  });

  const months = [...new Set(submissions.map((s) => s.submissionMonth))].sort();
  const approved = approvals.filter((a) => a.stage === 'APPROVED').length;

  console.log(`Department: ${dept.name}`);
  console.log(`  employees:   ${emps.length}`);
  console.log(`  submissions: ${submissions.length}  (months: ${months.join(', ') || 'none'})`);
  console.log(`  attachments: ${attachments}`);
  console.log(`  approvals:   ${approvals.length}  (${approved} fully approved)`);

  if (submissions.length === 0) {
    console.log('\nNothing recorded for this department - no change made.');
    await db.$disconnect();
    return;
  }

  if (!CONFIRMED) {
    console.log('\nRe-run with --yes to delete all of the above.');
    await db.$disconnect();
    return;
  }

  const delSubs = await db.kpiSubmission.deleteMany({ where: { employeeProfileId: { in: ids } } });
  const delAppr = await db.submissionApproval.deleteMany({ where: { employeeProfileId: { in: ids } } });

  await db.auditLog.create({
    data: {
      userId: null,
      action: 'SUBMISSION_MONTH_CLEARED',
      entityType: 'Department',
      entityId: dept.id,
      oldValues: JSON.stringify({
        department: dept.name,
        months,
        submissionsDeleted: delSubs.count,
        approvalsDeleted: delAppr.count,
        approvedCount: approved,
        attachmentsDeleted: attachments,
        reason: 'Bulk clear of all submissions for this department at administrator request.',
      }),
    },
  });

  const left = await db.kpiSubmission.count({ where: { employeeProfileId: { in: ids } } });
  console.log(`\nDeleted ${delSubs.count} submissions and ${delAppr.count} approval records.`);
  console.log(`Remaining for this department: ${left}`);
  await db.$disconnect();
})().catch(async (e) => {
  console.error('Failed:', e?.message || e);
  await db.$disconnect();
  process.exit(1);
});
