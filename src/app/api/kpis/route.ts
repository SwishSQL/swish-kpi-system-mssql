import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_library.view');
  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  const kpis = await db.kpi.findMany({
    where: q
      ? {
          OR: [
            { kpiCode: { contains: q } },
            { kpiName: { contains: q } },
          ],
        }
      : undefined,
    include: { responsibleDepartment: true, _count: { select: { assignments: true } } },
    orderBy: { kpiCode: 'asc' },
    take: 1000,
  });
  return NextResponse.json({
    kpis: kpis.map((k) => ({
      id: k.id,
      kpiCode: k.kpiCode,
      kpiName: k.kpiName,
      description: k.description,
      calculationMethod: k.calculationMethod,
      varianceIndicator: k.varianceIndicator,
      matrix: k.matrix,
      defaultTarget: k.defaultTarget,
      targetText: k.targetText,
      defaultThreshold: k.defaultThreshold,
      defaultWeight: k.defaultWeight,
      frequency: k.frequency,
      responsibleDepartmentId: k.responsibleDepartmentId,
      responsibleDepartmentText: k.responsibleDepartmentText,
      responsibleDepartmentName: k.responsibleDepartment?.name ?? null,
      formOfSubmission: k.formOfSubmission,
      scoreCap: k.scoreCap,
      zeroActualIsPerfect: k.zeroActualIsPerfect,
      isActive: k.isActive,
      assignmentCount: k._count.assignments,
    })),
    canManage: ctx.perms.has('kpi_library.manage'),
  });
});

const kpiSchema = z.object({
  kpiCode: z.string().min(1).max(60),
  kpiName: z.string().min(1).max(300),
  description: z.string().max(3000).optional(),
  calculationMethod: z.string().max(2000).optional(),
  varianceIndicator: z.enum(['U', 'D']),
  matrix: z.string().max(200).optional(),
  defaultTarget: z.number().nullable().optional(),
  targetText: z.string().max(300).optional(),
  responsibleDepartmentText: z.string().max(200).optional(),
  defaultThreshold: z.number().nullable().optional(),
  defaultWeight: z.number().min(0).max(100).nullable().optional(),
  frequency: z.string().max(50).optional(),
  responsibleDepartmentId: z.string().nullable().optional(),
  formOfSubmission: z.string().max(500).optional(),
  scoreCap: z.number().min(100).max(1000).optional(),
  zeroActualIsPerfect: z.boolean().optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_library.manage');
  const body = kpiSchema.parse(await req.json());

  const dup = await db.kpi.findUnique({ where: { kpiCode: body.kpiCode.trim() } });
  if (dup) throw new ApiError(409, 'A KPI with this code already exists.');

  const kpi = await db.kpi.create({
    data: {
      kpiCode: body.kpiCode.trim(),
      kpiName: body.kpiName.trim(),
      description: body.description ?? '',
      calculationMethod: body.calculationMethod ?? '',
      varianceIndicator: body.varianceIndicator,
      matrix: body.matrix ?? '',
      defaultTarget: body.defaultTarget ?? null,
      targetText: body.targetText ?? '',
      responsibleDepartmentText: body.responsibleDepartmentText ?? '',
      defaultThreshold: body.defaultThreshold ?? null,
      defaultWeight: body.defaultWeight ?? null,
      frequency: body.frequency ?? 'Monthly',
      responsibleDepartmentId: body.responsibleDepartmentId ?? null,
      formOfSubmission: body.formOfSubmission ?? '',
      scoreCap: body.scoreCap ?? 100,
      zeroActualIsPerfect: body.zeroActualIsPerfect ?? false,
    },
  });
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'KPI_CREATED',
    entityType: 'Kpi',
    entityId: kpi.id,
    newValues: body,
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });
  return NextResponse.json({ ok: true, id: kpi.id });
});
