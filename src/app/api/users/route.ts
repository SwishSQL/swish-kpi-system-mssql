import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { hashPassword, normalizeEmail, isValidEmail } from '@/lib/passwords';
import { manageableRoles, SystemRole } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'users.view');
  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { fullName: { contains: q } },
            { email: { contains: q } },
            { employeeId: { contains: q } },
          ],
        }
      : undefined,
    include: { employeeProfile: { include: { department: true } } },
    orderBy: { fullName: 'asc' },
    take: 500,
  });
  // Employees whose profile exists but who have no login. They never appear in
  // a list built from the user table, which is how two dozen people ended up
  // holding KPIs they had no way to submit.
  const withoutAccount = await db.employeeProfile.findMany({
    where: {
      userId: null,
      isActive: true,
      ...(q
        ? {
            OR: [
              { fullName: { contains: q } },
              { employeeId: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      department: true,
      _count: { select: { assignments: { where: { isActive: true } } } },
    },
    orderBy: { fullName: 'asc' },
  });

  return NextResponse.json({
    employeesWithoutAccount: withoutAccount.map((p) => ({
      employeeProfileId: p.id,
      employeeId: p.employeeId,
      fullName: p.fullName,
      department: p.department?.name ?? null,
      departmentId: p.departmentId,
      position: p.position,
      directManagerEmployeeId: p.directManagerEmployeeId,
      kpiCount: p._count.assignments,
    })),
    users: users.map((u) => ({
      id: u.id,
      employeeId: u.employeeId,
      fullName: u.fullName,
      email: u.email,
      systemRole: u.systemRole,
      isActive: u.isActive,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      department: u.employeeProfile?.department?.name ?? null,
      departmentId: u.employeeProfile?.departmentId ?? null,
      position: u.employeeProfile?.position ?? null,
      directManagerEmployeeId: u.employeeProfile?.directManagerEmployeeId ?? null,
    })),
  });
});

const createSchema = z.object({
  employeeId: z.string().min(1).max(50),
  fullName: z.string().min(1).max(200),
  email: z.string().min(3).max(200),
  systemRole: z.enum(['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_SPECIALIST', 'HR_ADMIN', 'EMPLOYEE']),
  departmentId: z.string().optional().nullable(),
  position: z.string().max(200).optional().nullable(),
  directManagerEmployeeId: z.string().max(50).optional().nullable(),
  temporaryPassword: z.string().max(200).optional().nullable(),
});

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'users.create');
  const body = createSchema.parse(await req.json());

  if (!manageableRoles(ctx.user.systemRole as SystemRole).includes(body.systemRole)) {
    throw new ApiError(403, 'You cannot create a user with a role higher than your authority.');
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) throw new ApiError(400, 'Invalid email format.');
  const employeeId = body.employeeId.trim();

  const [emailExists, empIdExists] = await Promise.all([
    db.user.findUnique({ where: { email } }),
    db.user.findUnique({ where: { employeeId } }),
  ]);
  if (emailExists) throw new ApiError(409, 'A user with this email already exists.');
  if (empIdExists) throw new ApiError(409, 'A user with this Employee ID already exists.');

  // Initial temporary password defaults to the Employee ID (migration rule).
  const tempPassword = body.temporaryPassword?.trim() || employeeId;

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        employeeId,
        fullName: body.fullName.trim(),
        email,
        passwordHash: await hashPassword(tempPassword),
        systemRole: body.systemRole,
        mustChangePassword: true,
      },
    });
    const existingProfile = await tx.employeeProfile.findUnique({ where: { employeeId } });
    if (existingProfile) {
      await tx.employeeProfile.update({
        where: { employeeId },
        data: {
          userId: created.id,
          fullName: body.fullName.trim(),
          departmentId: body.departmentId || existingProfile.departmentId,
          position: body.position ?? existingProfile.position,
          directManagerEmployeeId: body.directManagerEmployeeId ?? existingProfile.directManagerEmployeeId,
          isActive: true,
        },
      });
    } else {
      await tx.employeeProfile.create({
        data: {
          userId: created.id,
          employeeId,
          fullName: body.fullName.trim(),
          departmentId: body.departmentId || null,
          position: body.position || null,
          directManagerEmployeeId: body.directManagerEmployeeId || null,
        },
      });
    }
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: created.id,
      newValues: { employeeId, email, systemRole: body.systemRole },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
    return created;
  });

  return NextResponse.json({
    ok: true,
    userId: user.id,
    note: `Temporary password is ${body.temporaryPassword ? 'the one you provided' : 'the Employee ID'}. The user must change it on first login.`,
  });
});
