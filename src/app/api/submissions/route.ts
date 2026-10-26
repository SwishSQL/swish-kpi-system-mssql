import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { getVisibleScope } from '@/lib/access';
import { getDueAssignments, getVacationingEmployeeIds, getPeriod, periodIsEditable, parseMonthKey } from '@/lib/submissions';
import { employeeFinalScore } from '@/lib/scoring';
import {
  authorityIn,
  loadAuthorityContext,
  actionableLevel,
  monthKey,
  monthWithinWindow,
  STAGE_LABEL,
  Stage,
} from '@/lib/approvals';

export const dynamic = 'force-dynamic';

/**
 * Submission screen data: employee cards with compact KPI rows for the
 * selected month, restricted to the actor's visible scope.
 */
const currentMonthKey = monthKey;

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const sp = req.nextUrl.searchParams;
  const monthKey = sp.get('month');
  if (!monthKey) throw new ApiError(400, 'month=YYYY-MM is required.');
  const q = sp.get('q')?.trim().toLowerCase() || '';
  const departmentId = sp.get('departmentId') || '';
  const managerEmployeeId = sp.get('managerEmployeeId') || '';
  const submissionStatus = sp.get('submissionStatus') || '';
  const performanceStatus = sp.get('performanceStatus') || '';
  const kpiFilter = sp.get('kpiId') || '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(sp.get('pageSize')) || 20));

  const [viewScope, submitScope, period] = await Promise.all([
    getVisibleScope(ctx, false),
    getVisibleScope(ctx, true),
    getPeriod(monthKey),
  ]);
  const isReviewer =
    ctx.hasReports ||
    ctx.managedDepartmentIds.length > 0 ||
    ctx.perms.has('approvals.approve_compliance') ||
    ctx.user.systemRole === 'ADMIN' ||
    ctx.user.systemRole === 'SUPER_ADMIN';
  const withinBacklog = monthWithinWindow(monthKey, currentMonthKey(new Date()), isReviewer);
  const editable = periodIsEditable(period, withinBacklog);

  // Narrow to the people who belong on this page before touching their KPI
  // rows: sending all 300-odd employees with every row was three quarters of a
  // megabyte, and most of it was never scrolled to.
  const { year: viewedYear } = parseMonthKey(monthKey);
  // Everything except the department itself, so the department tabs can be
  // counted against the same search and status filters the list is using.
  const employeeWhereNoDepartment: Prisma.EmployeeProfileWhereInput = {
    isActive: true,
    assignments: { some: { year: viewedYear, isActive: true } },
    ...(viewScope.employeeProfileIds ? { id: { in: viewScope.employeeProfileIds } } : {}),
    ...(managerEmployeeId ? { directManagerEmployeeId: managerEmployeeId } : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q } },
            { employeeId: { contains: q } },
            {
              assignments: {
                some: {
                  year: viewedYear,
                  isActive: true,
                  kpi: {
                    OR: [
                      { kpiCode: { contains: q } },
                      { kpiName: { contains: q } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
    ...(kpiFilter
      ? { assignments: { some: { year: viewedYear, isActive: true, kpiId: kpiFilter } } }
      : {}),
    // Status filters look at this month's results, so they narrow the people
    // listed rather than blanking rows inside a page.
    ...(submissionStatus === 'NOT_STARTED'
      ? { submissions: { none: { submissionMonth: monthKey } } }
      : submissionStatus
        ? { submissions: { some: { submissionMonth: monthKey, submissionStatus: submissionStatus as any } } }
        : {}),
    ...(performanceStatus
      ? { submissions: { some: { submissionMonth: monthKey, performanceStatus: performanceStatus as any } } }
      : {}),
  };
  const employeeWhere: Prisma.EmployeeProfileWhereInput = departmentId
    ? { AND: [employeeWhereNoDepartment, { departmentId }] }
    : employeeWhereNoDepartment;

  // Department tabs: one count per department the viewer can see, so picking a
  // tab is the only way most people ever need to narrow this screen.
  const [deptCounts, deptNames] = await Promise.all([
    db.employeeProfile.groupBy({
      by: ['departmentId'],
      where: employeeWhereNoDepartment,
      _count: { _all: true },
    }),
    db.department.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(deptNames.map((d) => [d.id, d.name]));

  // The dot on each tab: green when everyone who has KPIs due has submitted
  // all of them, red when nobody has submitted anything, orange in between.
  // Deliberately not narrowed by the search/status filters the counts follow -
  // picking "Not started" must not turn every department red. Someone on
  // vacation has nothing due, so they drop out of the tally rather than
  // counting as a miss.
  const statusProfiles = await db.employeeProfile.findMany({
    where: {
      isActive: true,
      assignments: { some: { year: viewedYear, isActive: true } },
      ...(viewScope.employeeProfileIds ? { id: { in: viewScope.employeeProfileIds } } : {}),
    },
    select: { id: true, departmentId: true },
  });
  const statusIds = statusProfiles.map((p) => p.id);
  const [statusDue, statusSubs] = await Promise.all([
    getDueAssignments(monthKey, statusIds),
    db.kpiSubmission.findMany({
      where: {
        submissionMonth: monthKey,
        submissionStatus: { not: 'DRAFT' },
        employeeProfileId: { in: statusIds },
      },
      select: { kpiAssignmentId: true },
    }),
  ]);
  const submittedAssignmentIds = new Set(statusSubs.map((s) => s.kpiAssignmentId));
  const dueIdsByEmployee = new Map<string, string[]>();
  for (const a of statusDue) {
    const list = dueIdsByEmployee.get(a.employeeProfileId) ?? [];
    list.push(a.id);
    dueIdsByEmployee.set(a.employeeProfileId, list);
  }
  const deptOfProfile = new Map(statusProfiles.map((p) => [p.id, p.departmentId]));
  const deptTally = new Map<string | null, { total: number; complete: number; started: number }>();
  for (const [pid, dueIds] of dueIdsByEmployee) {
    const key = deptOfProfile.get(pid) ?? null;
    const t = deptTally.get(key) ?? { total: 0, complete: 0, started: 0 };
    const done = dueIds.filter((id) => submittedAssignmentIds.has(id)).length;
    t.total++;
    if (done === dueIds.length) t.complete++;
    if (done > 0) t.started++;
    deptTally.set(key, t);
  }

  const departmentTabs = deptCounts
    .map((d) => {
      const t = deptTally.get(d.departmentId);
      return {
        id: d.departmentId,
        name: d.departmentId ? (nameById.get(d.departmentId) ?? 'Unknown') : 'No department',
        employees: d._count._all,
        // null = nobody in it has anything due this month, so no verdict.
        submissionStatus: !t
          ? null
          : t.complete === t.total
            ? 'ALL'
            : t.started === 0
              ? 'NONE'
              : 'PARTIAL',
        submittedCount: t?.complete ?? 0,
        dueCount: t?.total ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalEmployees = await db.employeeProfile.count({ where: employeeWhere });
  const totalPages = Math.max(1, Math.ceil(totalEmployees / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageProfiles = await db.employeeProfile.findMany({
    where: employeeWhere,
    include: { department: true },
    orderBy: [{ department: { name: 'asc' } }, { fullName: 'asc' }],
    skip: (safePage - 1) * pageSize,
    take: pageSize,
  });

  const pagination = { page: safePage, pageSize, totalPages, totalEmployees };
  if (pageProfiles.length === 0) {
    return NextResponse.json({ period, editable, employees: [], pagination, departmentTabs });
  }

  const profileIds = pageProfiles.map((p) => p.id);
  const [assignments, vacationing] = await Promise.all([
    getDueAssignments(monthKey, profileIds),
    getVacationingEmployeeIds(monthKey, profileIds),
  ]);
  const [submissions, approvals] = await Promise.all([
    db.kpiSubmission.findMany({
      where: { submissionMonth: monthKey, kpiAssignmentId: { in: assignments.map((a) => a.id) } },
      include: {
        attachments: { select: { id: true, originalFileName: true, fileSize: true, uploadedAt: true } },
        submittedBy: { select: { fullName: true } },
      },
    }),
    db.submissionApproval.findMany({
      where: { submissionMonth: monthKey, employeeProfileId: { in: profileIds } },
    }),
  ]);
  const approvalByProfile = new Map(approvals.map((a) => [a.employeeProfileId, a]));

  // Read the reporting picture once: judging authority per row re-read every
  // active profile each time, which is most of what made this screen slow.
  const authorityContext = await loadAuthorityContext();
  const actor = {
    profileId: ctx.profile?.id ?? null,
    employeeId: ctx.profile?.employeeId ?? null,
    systemRole: ctx.user.systemRole,
    perms: ctx.perms,
  };

  const subByAssignment = new Map(submissions.map((s) => [s.kpiAssignmentId, s]));
  const profileMap = new Map(pageProfiles.map((p) => [p.id, p]));
  const submitSet = submitScope.employeeProfileIds === null ? null : new Set(submitScope.employeeProfileIds);

  const employees = [] as any[];
  for (const pid of profileIds) {
    const profile = profileMap.get(pid);
    if (!profile) continue;

    const empAssignments = assignments.filter((a) => a.employeeProfileId === pid);

    const approval = approvalByProfile.get(pid) ?? null;
    const authority = authorityIn(authorityContext, actor, pid);
    const canActNow = approval ? actionableLevel(authority.levels, approval.stage as Stage) : null;

    // An employee sees their own scores only once compliance has signed off;
    // reviewers and admins always see them, since they judge the numbers.
    const viewingOwnAsStaff =
      ctx.profile?.id === pid && authority.levels.length === 0 && !authority.isAdmin;
    const scoresVisible = !viewingOwnAsStaff || approval?.stage === 'APPROVED';

    const rows = empAssignments.map((a) => {
      const sub = subByAssignment.get(a.id) ?? null;
      return {
        assignmentId: a.id,
        kpi: {
          id: a.kpiId,
          code: a.kpi.kpiCode,
          name: a.kpi.kpiName,
          description: a.kpi.description,
          calculationMethod: a.kpi.calculationMethod,
          varianceIndicator: a.kpi.varianceIndicator,
          matrixType: a.kpi.matrixType,
        },
        target: a.target,
        threshold: a.threshold,
        weight: a.weight,
        frequency: a.frequency,
        formOfSubmission: a.formOfSubmission,
        submission: sub
          ? {
              id: sub.id,
              actualResult: sub.actualResult,
              calculatedScore: scoresVisible ? sub.calculatedScore : null,
              weightedScore: scoresVisible ? sub.weightedScore : null,
              submissionStatus: sub.submissionStatus,
              performanceStatus: scoresVisible ? sub.performanceStatus : null,
              comment: sub.comment,
              version: sub.version,
              submittedByName: sub.submittedBy?.fullName ?? null,
              submittedOnBehalf: sub.submittedOnBehalfOfEmployee,
              submittedAt: sub.submittedAt,
              updatedAt: sub.updatedAt,
              attachments: sub.attachments,
              // Each KPI carries its own place in the approval chain, so the
              // row's actions are judged against its stage, not the month's.
              stage: sub.stage,
              stageLabel: STAGE_LABEL[sub.stage as Stage],
              // A DRAFT is not in the chain yet - attaching a file creates one
              // with a zero actual and the default PENDING_LINE_MANAGER stage,
              // which made the row advertise an Approve button the approve
              // route then refused with "nothing to approve". Offer nothing
              // until it has actually been submitted.
              canApproveAs:
                sub.submissionStatus === 'DRAFT'
                  ? null
                  : actionableLevel(authority.levels, sub.stage as Stage),
              // Sending a KPI back a stage is an administrative correction.
              canRevert:
                authority.isAdmin &&
                sub.submissionStatus !== 'DRAFT' &&
                sub.stage !== 'PENDING_LINE_MANAGER',
              // An admin may correct any KPI at any stage; everyone else only
              // while it is theirs to act on.
              canEdit:
                editable.editable &&
                (authority.isAdmin ||
                  (sub.stage !== 'APPROVED' &&
                    (authority.levels.length > 0
                      ? !!actionableLevel(authority.levels, sub.stage as Stage)
                      : sub.submissionStatus === 'DRAFT'))),
            }
          : null,
      };
    });


    const finalized = rows.filter(
      (r) => r.submission && r.submission.submissionStatus !== 'DRAFT'
    );
    const complete = finalized.length === rows.length && rows.length > 0;
    const { finalScore } = employeeFinalScore(
      rows.map((r) => ({
        score: r.submission?.calculatedScore ?? 0,
        weight: r.weight,
      }))
    );

    // The weights that must total 100 are the ones that score THIS month - the
    // rows on the card, which is exactly what finalScore adds up. This used to
    // sum every active assignment in the year, which was right while frequency
    // decided which months a KPI was due in. Now that an assignment can be
    // limited to certain months (and a KPI can be inactive, pending approval or
    // past its end date), the year's total includes weights that are not on the
    // screen and not in this month's score, and a card showing 30+40+30 read
    // "Weights 130%" with nothing visible to account for the extra 30.
    // Someone with nothing due (on vacation, or no KPIs this month) has no
    // weights to judge, so no warning rather than "0%".
    const { totalWeight, weightsValid } =
      rows.length === 0
        ? { totalWeight: 0, weightsValid: true }
        : employeeFinalScore(rows.map((r) => ({ score: 0, weight: r.weight })));

    employees.push({
      profile: {
        id: profile.id,
        employeeId: profile.employeeId,
        fullName: profile.fullName,
        position: profile.position,
        departmentId: profile.departmentId,
        departmentName: profile.department?.name ?? null,
      },
      rows,
      complete,
      finalScore: complete && scoresVisible ? finalScore : null,
      scoresVisible,
      approval: approval
        ? {
            stage: approval.stage,
            stageLabel: STAGE_LABEL[approval.stage as Stage],
            submittedAt: approval.submittedAt,
            lineManagerAt: approval.lineManagerAt,
            departmentManagerAt: approval.departmentManagerAt,
            complianceAt: approval.complianceAt,
          }
        : null,
      canApproveAs: canActNow,
      // Deliberately narrower than canSubmit: an employee who put their own
      // results under the wrong month is exactly who should not be trusted to
      // relabel them - that is moving the same mistake, not correcting it.
      canMoveMonth: authority.levels.length > 0 || authority.isAdmin,
      // Same authority as moving a month - a reviewer's correction on someone
      // else's behalf, never the employee themselves.
      onVacation: vacationing.has(pid),
      canMarkVacation: authority.levels.length > 0 || authority.isAdmin,
      totalWeight,
      weightsValid,
      canSubmit:
        editable.editable &&
        (submitSet === null || submitSet.has(pid)) &&
        // Staff hand over control the moment the month is with a reviewer.
        (approval === null || authority.levels.length > 0 || authority.isAdmin) &&
        approval?.stage !== 'APPROVED',
      hasExisting: rows.some((r) => r.submission && r.submission.submissionStatus !== 'DRAFT'),
    });
  }

  return NextResponse.json({
    period,
    editable,
    // Company-wide viewers (compliance, admins) work department by department.
    groupByDepartment: ctx.perms.has('submissions.view_all') && !departmentId,
    employees,
    pagination,
    departmentTabs,
  });
});
