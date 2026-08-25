import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name: z.string().min(1).max(200).optional(),
  departmentManagerEmployeeId: z.string().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'departments.manage');
  const body = patchSchema.parse(await req.json());

  const dept = await db.department.findUnique({ where: { id: params.id } });
  if (!dept) throw new ApiError(404, 'Department not found.');

  if (body.departmentManagerEmployeeId) {
    const mgr = await db.employeeProfile.findUnique({
      where: { employeeId: body.departmentManagerEmployeeId },
    });
    if (!mgr) throw new ApiError(400, 'Department manager employee not found.');
  }

  // Code and name are both unique, so a clash is answered in words rather than
  // as a raw constraint failure.
  const code = body.code?.trim();
  const name = body.name?.trim();
  if (code && code !== dept.code) {
    const clash = await db.department.findUnique({ where: { code } });
    if (clash) throw new ApiError(409, `Another department already uses the code "${code}".`);
  }
  if (name && name !== dept.name) {
    const clash = await db.department.findUnique({ where: { name } });
    if (clash) throw new ApiError(409, `Another department is already called "${name}".`);
  }

  await db.$transaction(async (tx) => {
    await tx.department.update({
      where: { id: dept.id },
      data: {
        code: body.code?.trim(),
        name: body.name?.trim(),
        departmentManagerEmployeeId:
          body.departmentManagerEmployeeId === undefined ? undefined : body.departmentManagerEmployeeId,
        isActive: body.isActive,
      },
    });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'DEPARTMENT_UPDATED',
      entityType: 'Department',
      entityId: dept.id,
      oldValues: {
        code: dept.code,
        name: dept.name,
        departmentManagerEmployeeId: dept.departmentManagerEmployeeId,
        isActive: dept.isActive,
      },
      newValues: body,
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({ ok: true });
});
