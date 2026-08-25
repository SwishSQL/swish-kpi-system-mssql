import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { getVisibleScope } from '@/lib/access';
import { logAudit } from '@/lib/audit';

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
  const submissions = await db.kpiSubmission.findMany({
    where: {
      submissionMonth: monthKey,
      submissionStatus: { not: 'DRAFT' },
      ...(scope.employeeProfileIds ? { employeeProfileId: { in: scope.employeeProfileIds } } : {}),
    },
    include: {
      employee: { include: { department: true } },
      kpiAssignment: { include: { kpi: true } },
      submittedBy: { select: { fullName: true } },
      _count: { select: { attachments: true } },
    },
    orderBy: [{ employee: { fullName: 'asc' } }],
  });

  const header = [
    'Period', 'Department', 'Employee ID', 'Employee Name', 'KPI Code', 'KPI Name',
    'Variance', 'Target', 'Threshold', 'Weight', 'Actual', 'Score', 'Weighted Score',
    'Performance Status', 'Submission Status', 'Comment', 'Attachments',
    'Submitted By', 'Submitted At', 'Updated At',
  ];
  const rows = submissions.map((s) => [
    s.submissionMonth,
    s.employee.department?.name ?? '',
    s.employee.employeeId,
    s.employee.fullName,
    s.kpiAssignment.kpi.kpiCode,
    s.kpiAssignment.kpi.kpiName,
    s.kpiAssignment.kpi.varianceIndicator,
    s.kpiAssignment.target,
    s.kpiAssignment.threshold,
    s.kpiAssignment.weight,
    s.actualResult,
    s.calculatedScore,
    s.weightedScore,
    s.performanceStatus,
    s.submissionStatus,
    s.comment,
    s._count.attachments,
    s.submittedBy?.fullName ?? '',
    s.submittedAt.toISOString(),
    s.updatedAt.toISOString(),
  ]);

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
