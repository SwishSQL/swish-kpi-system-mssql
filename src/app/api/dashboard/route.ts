import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { getVisibleScope } from '@/lib/access';
import { getDueAssignments } from '@/lib/submissions';
import { employeeFinalScore, distributionBucket, round2 } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

function prevMonths(monthKey: string, count: number): string[] {
  const [y, m] = monthKey.split('-').map(Number);
  const out: string[] = [];
  let year = y;
  let month = m;
  for (let i = 0; i < count; i++) {
    out.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month--;
    if (month === 0) {
      month = 12;
      year--;
    }
  }
  return out;
}

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const sp = req.nextUrl.searchParams;
  const monthKey = sp.get('month');
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) throw new ApiError(400, 'month=YYYY-MM is required.');
  const departmentId = sp.get('departmentId') || '';

  const scope = await getVisibleScope(ctx, false);
  const assignments = await getDueAssignments(monthKey, scope.employeeProfileIds);

  const profileIds = [...new Set(assignments.map((a) => a.employeeProfileId))];
  const profiles = await db.employeeProfile.findMany({
    where: { id: { in: profileIds } },
    include: { department: true },
  });
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const filteredIds = departmentId
    ? profileIds.filter((id) => profileMap.get(id)?.departmentId === departmentId)
    : profileIds;

  const submissions = await db.kpiSubmission.findMany({
    where: {
      submissionMonth: monthKey,
      employeeProfileId: { in: filteredIds },
      submissionStatus: { not: 'DRAFT' },
    },
  });
  const subsByEmployee = new Map<string, typeof submissions>();
  for (const s of submissions) {
    const arr = subsByEmployee.get(s.employeeProfileId) ?? [];
    arr.push(s);
    subsByEmployee.set(s.employeeProfileId, arr);
  }

  // Approval stage per employee, for the department table's "approved" and
  // "not started" columns.
  const approvals = await db.submissionApproval.findMany({
    where: { submissionMonth: monthKey, employeeProfileId: { in: filteredIds } },
    select: { employeeProfileId: true, stage: true },
  });
  const approvalStageByEmployee = new Map(approvals.map((a) => [a.employeeProfileId, a.stage]));

  interface EmpStat {
    profileId: string;
    employeeId: string;
    name: string;
    departmentId: string | null;
    departmentName: string | null;
    assigned: number;
    submitted: number;
    complete: boolean;
    finalScore: number | null;
    belowThresholdKpis: string[];
    approved: boolean;
  }

  const assignmentsByEmployee = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (!filteredIds.includes(a.employeeProfileId)) continue;
    const arr = assignmentsByEmployee.get(a.employeeProfileId) ?? [];
    arr.push(a);
    assignmentsByEmployee.set(a.employeeProfileId, arr);
  }

  const stats: EmpStat[] = [];
  for (const [pid, empAssignments] of assignmentsByEmployee) {
    const profile = profileMap.get(pid);
    if (!profile) continue;
    const subs = subsByEmployee.get(pid) ?? [];
    const subByAssignment = new Map(subs.map((s) => [s.kpiAssignmentId, s]));
    const complete = empAssignments.every((a) => subByAssignment.has(a.id));
    const { finalScore } = employeeFinalScore(
      empAssignments.map((a) => ({
        score: subByAssignment.get(a.id)?.calculatedScore ?? 0,
        weight: a.weight,
      }))
    );
    stats.push({
      profileId: pid,
      employeeId: profile.employeeId,
      name: profile.fullName,
      departmentId: profile.departmentId,
      departmentName: profile.department?.name ?? null,
      assigned: empAssignments.length,
      submitted: subs.length,
      complete,
      finalScore: complete ? finalScore : null,
      belowThresholdKpis: empAssignments
        .filter((a) => subByAssignment.get(a.id)?.performanceStatus === 'BELOW_THRESHOLD')
        .map((a) => a.kpi.kpiCode),
      approved: approvalStageByEmployee.get(pid) === 'APPROVED',
    });
  }

  const total = stats.length;
  const completed = stats.filter((s) => s.complete);
  const completedAvg = completed.length
    ? round2(completed.reduce((s, e) => s + (e.finalScore ?? 0), 0) / completed.length)
    : null;
  const strictScore = total
    ? round2(completed.reduce((s, e) => s + (e.finalScore ?? 0), 0) / total)
    : null;
  const completionRate = total ? round2((completed.length / total) * 100) : 0;
  const kpisDueTotal = stats.reduce((s, e) => s + e.assigned, 0);
  const kpisSubmittedTotal = stats.reduce((s, e) => s + e.submitted, 0);
  const kpiSubmitRate = kpisDueTotal ? round2((kpisSubmittedTotal / kpisDueTotal) * 100) : 0;
  const approvedEmployees = stats.filter((s) => s.approved).length;
  const belowThresholdEmployees = stats.filter((s) => s.belowThresholdKpis.length > 0).length;

  const distribution: Record<string, number> = {
    EXCELLENT: 0,
    GOOD: 0,
    NEEDS_IMPROVEMENT: 0,
    CRITICAL: 0,
    NOT_SUBMITTED: 0,
  };
  for (const s of stats) distribution[distributionBucket(s.finalScore)]++;

  // Monthly trend (average completed final score approximation per month)
  const months = prevMonths(monthKey, 6);
  const trendSubs = await db.kpiSubmission.findMany({
    where: {
      submissionMonth: { in: months },
      employeeProfileId: { in: filteredIds },
      submissionStatus: { not: 'DRAFT' },
    },
    select: { submissionMonth: true, weightedScore: true, employeeProfileId: true },
  });
  const trend = months.map((mk) => {
    const perEmp = new Map<string, number>();
    for (const s of trendSubs) {
      if (s.submissionMonth !== mk) continue;
      perEmp.set(s.employeeProfileId, (perEmp.get(s.employeeProfileId) ?? 0) + s.weightedScore);
    }
    const values = [...perEmp.values()];
    return {
      month: mk,
      avgScore: values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null,
      employees: values.length,
    };
  });

  // Department comparison (company-wide views only)
  let departmentComparison: any[] = [];
  if (ctx.perms.has('dashboards.view_all') && !departmentId) {
    const byDept = new Map<string, EmpStat[]>();
    for (const s of stats) {
      const key = s.departmentName ?? 'Unassigned';
      const arr = byDept.get(key) ?? [];
      arr.push(s);
      byDept.set(key, arr);
    }
    departmentComparison = [...byDept.entries()]
      .map(([name, list]) => {
        const comp = list.filter((s) => s.complete);
        // KPIs due/submitted, counted at the row level rather than per
        // employee - this is what actually moved when someone fills in one
        // KPI out of several, which "employee complete" cannot show.
        const kpisDue = list.reduce((s, e) => s + e.assigned, 0);
        const kpisSubmitted = list.reduce((s, e) => s + e.submitted, 0);
        return {
          department: name,
          employees: list.length,
          completed: comp.length,
          completionRate: list.length ? round2((comp.length / list.length) * 100) : 0,
          avgScore: comp.length
            ? round2(comp.reduce((s, e) => s + (e.finalScore ?? 0), 0) / comp.length)
            : null,
          kpisDue,
          kpisSubmitted,
          submitRate: kpisDue ? round2((kpisSubmitted / kpisDue) * 100) : 0,
          approvedEmployees: list.filter((s) => s.approved).length,
          notStartedEmployees: list.filter((s) => s.submitted === 0).length,
        };
      })
      // Whoever is furthest behind on submitting belongs at the top - that is
      // the list someone chasing departments actually needs first.
      .sort((a, b) => a.submitRate - b.submitRate);
  }

  return NextResponse.json({
    month: monthKey,
    cards: {
      overallScore: completedAvg,
      strictScore,
      completionRate,
      submittedEmployees: completed.length,
      totalEmployees: total,
      belowThresholdEmployees,
      kpiSubmitRate,
      kpisDueTotal,
      kpisSubmittedTotal,
      approvedEmployees,
    },
    ranking: stats
      .map((s) => ({
        employeeId: s.employeeId,
        profileId: s.profileId,
        name: s.name,
        department: s.departmentName,
        score: s.finalScore,
        complete: s.complete,
        submitted: s.submitted,
        assigned: s.assigned,
        belowThresholdKpis: s.belowThresholdKpis,
      }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    distribution,
    trend,
    departmentComparison,
    notSubmitted: stats
      .filter((s) => !s.complete)
      .map((s) => ({ employeeId: s.employeeId, name: s.name, submitted: s.submitted, assigned: s.assigned })),
  });
});
