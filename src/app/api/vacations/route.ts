import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorityOver } from '@/lib/approvals';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  employeeProfileId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

async function requireAuthority(ctx: Awaited<ReturnType<typeof getCtx>>, employeeProfileId: string) {
  const profile = await db.employeeProfile.findUnique({
    where: { id: employeeProfileId },
    select: { id: true, employeeId: true, fullName: true },
  });
  if (!profile) throw new ApiError(404, 'Employee not found.');

  const authority = await authorityOver(
    {
      profileId: ctx.profile?.id ?? null,
      employeeId: ctx.profile?.employeeId ?? null,
      systemRole: ctx.user.systemRole,
      perms: ctx.perms,
    },
    profile.id
  );
  if (!(authority.levels.length > 0 || authority.isAdmin)) {
    throw new ApiError(403, "Only this employee's reviewer or an administrator can mark vacation.");
  }
  return profile;
}

/**
 * Marks an employee away for a whole month, so getDueAssignments() (in
 * src/lib/submissions.ts) stops requiring and stops counting their KPIs for
 * it - see that function for why nothing else needs to know this exists.
 * Allowed even when results are already recorded for the month; they are
 * left untouched and simply stop being displayed/counted while this is set.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json());
  const profile = await requireAuthority(ctx, body.employeeProfileId);

  await db.$transaction(async (tx) => {
    await tx.employeeVacation.upsert({
      where: { employeeProfileId_submissionMonth: { employeeProfileId: profile.id, submissionMonth: body.month } },
      create: { employeeProfileId: profile.id, submissionMonth: body.month, markedByUserId: ctx.user.id },
      update: {},
    });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'VACATION_MARKED',
      entityType: 'EmployeeProfile',
      entityId: profile.id,
      newValues: { employeeId: profile.employeeId, month: body.month },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json());
  const profile = await requireAuthority(ctx, body.employeeProfileId);

  await db.$transaction(async (tx) => {
    await tx.employeeVacation.deleteMany({
      where: { employeeProfileId: profile.id, submissionMonth: body.month },
    });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'VACATION_UNMARKED',
      entityType: 'EmployeeProfile',
      entityId: profile.id,
      oldValues: { employeeId: profile.employeeId, month: body.month },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({ ok: true });
});
