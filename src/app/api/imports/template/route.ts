import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Headers are chosen to match the importer's synonyms exactly, so a file filled
 * in from this template maps itself without anyone touching the mapping step.
 */
const TEMPLATES = {
  employees: [
    'Employee ID',
    'Full Name',
    'Work Email',
    'Department',
    'Position',
    'Direct Manager',
    'Date of Hiring',
    'Active',
  ],
  kpi_library: [
    'KPI Code',
    'KPI Name',
    'Description',
    'Calculation Method',
    'Variance Indicator',
    'Matrix',
    'Target',
    'Threshold',
    'Weight',
    'Frequency',
    'Responsible Department',
    'Form of Submission',
  ],
  assignments: [
    'Emp. ID',
    'Emp. Name',
    'Department',
    'Position',
    'Date of Hiring',
    'Perspective',
    'KPI Code',
    'KPI Name',
    'Variance Indicator',
    'Matrix',
    'Weight',
    'Frequency',
    'Target',
    'Threshold',
    'Form of Submission',
  ],
} as const;

type TemplateType = keyof typeof TEMPLATES;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const type = req.nextUrl.searchParams.get('type') as TemplateType | null;
  const withData = req.nextUrl.searchParams.get('withData') === '1';

  if (!type || !(type in TEMPLATES)) {
    throw new ApiError(400, 'type must be "employees" or "kpi_library".');
  }
  const OWNING_PERMISSION: Record<TemplateType, string> = {
    employees: 'users.create',
    kpi_library: 'kpi_library.manage',
    assignments: 'kpi_assignments.manage',
  };
  requirePerm(ctx, OWNING_PERMISSION[type], 'imports.run');

  const headers = [...TEMPLATES[type]];
  const rows: unknown[][] = [];

  // Exporting the current rows turns the template into an edit-and-return
  // sheet, which beats retyping 651 KPIs to change a handful.
  if (withData && type === 'kpi_library') {
    const kpis = await db.kpi.findMany({ orderBy: { kpiCode: 'asc' } });
    for (const k of kpis) {
      rows.push([
        k.kpiCode, k.kpiName, k.description, k.calculationMethod,
        k.varianceIndicator, k.matrixType,
        k.targetText || (k.defaultTarget ?? ''),
        k.defaultThreshold ?? '', k.defaultWeight ?? '',
        k.frequency, k.responsibleDepartmentText, k.formOfSubmission,
      ]);
    }
  }
  if (withData && type === 'assignments') {
    const assignments = await db.kpiAssignment.findMany({
      where: { year: new Date().getFullYear(), isActive: true },
      include: { employee: { include: { department: true } }, kpi: true },
      orderBy: [{ employee: { fullName: 'asc' } }, { kpi: { kpiCode: 'asc' } }],
    });
    for (const a of assignments) {
      rows.push([
        a.employee.employeeId, a.employee.fullName, a.employee.department?.name ?? '',
        a.employee.position ?? '',
        a.employee.dateOfHiring ? a.employee.dateOfHiring.toISOString().slice(0, 10) : '',
        a.employee.perspective ?? '',
        a.kpi.kpiCode, a.kpi.kpiName, a.kpi.varianceIndicator, a.kpi.matrixType,
        a.weight, a.frequency, a.target, a.threshold, a.formOfSubmission,
      ]);
    }
  }
  if (withData && type === 'employees') {
    const profiles = await db.employeeProfile.findMany({
      where: { isActive: true },
      include: { department: true, user: { select: { email: true } } },
      orderBy: { fullName: 'asc' },
    });
    for (const p of profiles) {
      rows.push([
        p.employeeId, p.fullName, p.user?.email ?? '', p.department?.name ?? '',
        p.position ?? '', p.directManagerEmployeeId ?? '',
        p.dateOfHiring ? p.dateOfHiring.toISOString().slice(0, 10) : '',
        p.isActive ? 'Yes' : 'No',
      ]);
    }
  }

  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const name = `${type}-${withData ? 'current-data' : 'template'}.csv`;

  // The BOM keeps Excel from mangling non-ASCII names when it opens the file.
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
});
