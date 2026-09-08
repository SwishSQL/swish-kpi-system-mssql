import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { getVisibleScope } from '@/lib/access';
import { logAudit } from '@/lib/audit';
import { getDueAssignments } from '@/lib/submissions';
import { STAGE_LABEL, type Stage } from '@/lib/approvals';

export const dynamic = 'force-dynamic';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'reports.export');
  const monthKey = req.nextUrl.searchParams.get('month');
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) throw new ApiError(400, 'month=YYYY-MM required.');

  const scope = await getVisibleScope(ctx, false);

  // Every KPI due this month, whether or not it has a result yet - a plain
  // dump of KpiSubmission rows made anyone who hasn't submitted, or whose
  // result is still moving through the approval chain, invisible in the
  // export.
  const [assignments, submissions] = await Promise.all([
    getDueAssignments(monthKey, scope.employeeProfileIds).then((list) =>
      db.kpiAssignment.findMany({
        where: { id: { in: list.map((a) => a.id) } },
        include: { employee: { include: { department: true } }, kpi: true },
        orderBy: [{ employee: { fullName: 'asc' } }],
      })
    ),
    db.kpiSubmission.findMany({
      where: {
        submissionMonth: monthKey,
        submissionStatus: { not: 'DRAFT' },
        ...(scope.employeeProfileIds ? { employeeProfileId: { in: scope.employeeProfileIds } } : {}),
      },
      include: { submittedBy: { select: { fullName: true } }, _count: { select: { attachments: true } } },
    }),
  ]);
  const byAssignmentId = new Map(submissions.map((s) => [s.kpiAssignmentId, s]));

  const header = [
    'Period', 'Department', 'Employee ID', 'Employee Name', 'KPI Code', 'KPI Name',
    'Variance', 'Target', 'Threshold', 'Weight', 'Actual', 'Score', 'Weighted Score',
    'Performance Status', 'Approval Status', 'Submission Status', 'Comment', 'Attachments',
    'Submitted By', 'Submitted At', 'Updated At',
  ];
  const rows = assignments.map((a) => {
    const s = byAssignmentId.get(a.id) ?? null;
    return [
      monthKey,
      a.employee.department?.name ?? '',
      a.employee.employeeId,
      a.employee.fullName,
      a.kpi.kpiCode,
      a.kpi.kpiName,
      a.kpi.varianceIndicator,
      a.target,
      a.threshold,
      a.weight,
      s?.actualResult ?? '',
      s?.calculatedScore ?? '',
      s?.weightedScore ?? '',
      s?.performanceStatus ?? '',
      s ? STAGE_LABEL[s.stage as Stage] : 'Not started',
      s?.submissionStatus ?? '',
      s?.comment ?? '',
      s?._count.attachments ?? 0,
      s?.submittedBy?.fullName ?? '',
      s?.submittedAt.toISOString() ?? '',
      s?.updatedAt.toISOString() ?? '',
    ];
  });

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'REPORT_EXPORTED',
    entityType: 'KpiSubmission',
    entityId: monthKey,
    newValues: { rows: rows.length },
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });

  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kpi-report-${monthKey}.csv"`,
    },
  });
});
