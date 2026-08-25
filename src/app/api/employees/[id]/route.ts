import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { revokeAllSessions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Takes an employee off the submission screens.
 *
 * What that means depends on what they hold. A row left over from testing -
 * nothing ever recorded against it - is deleted outright, along with its KPI
 * assignments. Anyone with results to their name is deactivated instead: those
 * results are appraisal history and deleting the person would take them with
 * it. The caller is told which of the two happened.
 */
export const DELETE = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'users.deactivate');
  if (ctx.user.systemRole !== 'SUPER_ADMIN' && ctx.user.systemRole !== 'ADMIN') {
    throw new ApiError(403, 'Only an administrator can remove an employee.');
  }

  const profile = await db.employeeProfile.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, email: true, systemRole: true } },
      _count: { select: { submissions: true, assignments: true, reports: true } },
    },
  });
  if (!profile) throw new ApiError(404, 'Employee not found.');

  if (ctx.profile?.id === profile.id) {
    throw new ApiError(400, 'You cannot remove your own employee record.');
  }
  if (profile.user?.systemRole === 'SUPER_ADMIN' && ctx.user.systemRole !== 'SUPER_ADMIN') {
    throw new ApiError(403, 'You cannot remove a super administrator.');
  }
  // The reporting line hangs off employeeId, so removing a manager would leave
  // their team pointing at nobody.
  if (profile._count.reports > 0) {
    throw new ApiError(
      409,
      `${profile.fullName} still has ${profile._count.reports} employee${profile._count.reports === 1 ? '' : 's'} reporting to them. Move that team to another manager under Admin → Hierarchy first.`,
      'HAS_REPORTS'
    );
  }

  const hasHistory = profile._count.submissions > 0;
  const departmentManagerOf = await db.department.count({
    where: { departmentManagerEmployeeId: profile.employeeId },
  });

  // Deleting someone who manages a department would leave that department
  // without an approver, so they are deactivated instead whatever their history.
  const mode: 'deleted' | 'deactivated' = hasHistory || departmentManagerOf > 0 ? 'deactivated' : 'deleted';

  await db.$transaction(async (tx) => {
    if (mode === 'deleted') {
      // The profile still points at the user, and on SQL Server that FK is
      // NoAction - unlink it before either row can go.
      if (profile.user) {
        await tx.employeeProfile.update({ where: { id: profile.id }, data: { userId: null } });
      }
      // Assignments and any draft approvals cascade with the profile.
      await tx.employeeProfile.delete({ where: { id: profile.id } });
      // A login that only ever existed for this record goes too, unless other
      // records still point at it - the audit trail, results they entered for
      // someone else, approvals they signed. Those FKs are NoAction on SQL
      // Server, so a hard delete with any of them present would fail anyway.
      if (profile.user) {
        const uid = profile.user.id;
        const [trail, submitted, approvals, events, uploads, imports] = await Promise.all([
          tx.auditLog.count({ where: { userId: uid } }),
          tx.kpiSubmission.count({ where: { submittedByUserId: uid } }),
          tx.submissionApproval.count({
            where: {
              OR: [
                { submittedByUserId: uid },
                { lineManagerUserId: uid },
                { departmentManagerUserId: uid },
                { complianceUserId: uid },
              ],
            },
          }),
          tx.approvalEvent.count({ where: { userId: uid } }),
          tx.attachment.count({ where: { uploadedByUserId: uid } }),
          tx.importJob.count({ where: { uploadedByUserId: uid } }),
        ]);
        const referenced = trail + submitted + approvals + events + uploads + imports;
        if (referenced === 0) await tx.user.delete({ where: { id: uid } });
        else await tx.user.update({ where: { id: uid }, data: { isActive: false } });
      }
    } else {
      await tx.employeeProfile.update({ where: { id: profile.id }, data: { isActive: false } });
      if (profile.user) {
        await tx.user.update({ where: { id: profile.user.id }, data: { isActive: false } });
      }
    }

    await logAudit(tx, {
      userId: ctx.user.id,
      action: mode === 'deleted' ? 'EMPLOYEE_DELETED' : 'EMPLOYEE_DEACTIVATED',
      entityType: 'EmployeeProfile',
      entityId: profile.id,
      oldValues: {
        employeeId: profile.employeeId,
        fullName: profile.fullName,
        position: profile.position,
        departmentId: profile.departmentId,
        assignments: profile._count.assignments,
        submissions: profile._count.submissions,
        linkedAccount: profile.user?.email ?? null,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  if (profile.user) await revokeAllSessions(profile.user.id);

  return NextResponse.json({
    ok: true,
    mode,
    employeeName: profile.fullName,
    assignmentsRemoved: mode === 'deleted' ? profile._count.assignments : 0,
    submissionsKept: profile._count.submissions,
    reason:
      mode === 'deleted'
        ? null
        : departmentManagerOf > 0
          ? 'They manage a department, so the record was hidden rather than deleted.'
          : `They have ${profile._count.submissions} recorded result${profile._count.submissions === 1 ? '' : 's'}, so the record was hidden rather than deleted.`,
  });
});
