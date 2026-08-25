import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { canAccessProfile } from '@/lib/access';
import { getPeriod, periodIsEditable } from '@/lib/submissions';
import {
  validateUploadFile,
  checksumOf,
  makeStorageKey,
  putFile,
  MAX_FILES_PER_KPI,
} from '@/lib/storage';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Upload one attachment for a KPI (assignment + month). Creates a DRAFT
 * submission when none exists yet, so files are uploaded exactly once
 * before the final one-button submit.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const form = await req.formData();
  const file = form.get('file');
  const kpiAssignmentId = String(form.get('kpiAssignmentId') || '');
  const month = String(form.get('month') || '');

  if (!(file instanceof File)) throw new ApiError(400, 'file is required.');
  if (!kpiAssignmentId) throw new ApiError(400, 'kpiAssignmentId is required.');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError(400, 'month=YYYY-MM is required.');

  const assignment = await db.kpiAssignment.findUnique({
    where: { id: kpiAssignmentId },
    include: { kpi: true, employee: true },
  });
  if (!assignment) throw new ApiError(404, 'KPI assignment not found.');

  const canSubmit = await canAccessProfile(ctx, assignment.employeeProfileId, true);
  if (!canSubmit) throw new ApiError(403, 'You cannot upload attachments for this employee.');

  const period = await getPeriod(month);
  const editable = periodIsEditable(period);
  if (!editable.editable) throw new ApiError(409, editable.reason || 'This month is not editable.');

  const err = validateUploadFile(file.name, file.type || 'application/octet-stream', file.size);
  if (err) throw new ApiError(400, err);

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = checksumOf(buffer);
  const storageKey = makeStorageKey(file.name);

  const result = await db.$transaction(async (tx) => {
    let submission = await tx.kpiSubmission.findUnique({
      where: {
        kpiAssignmentId_submissionMonth: { kpiAssignmentId, submissionMonth: month },
      },
      include: { _count: { select: { attachments: true } } },
    });
    if (submission?.submissionStatus === 'LOCKED') {
      throw new ApiError(409, 'This submission is locked.');
    }
    if (!submission) {
      submission = {
        ...(await tx.kpiSubmission.create({
          data: {
            employeeProfileId: assignment.employeeProfileId,
            kpiAssignmentId,
            submissionMonth: month,
            actualResult: 0,
            normalizedActualResult: 0,
            calculatedScore: 0,
            weightedScore: 0,
            submissionStatus: 'DRAFT',
            performanceStatus: 'BELOW_THRESHOLD',
            submittedByUserId: ctx.user.id,
          },
        })),
        _count: { attachments: 0 },
      } as any;
    }

    if (submission!._count.attachments >= MAX_FILES_PER_KPI) {
      throw new ApiError(400, `Maximum ${MAX_FILES_PER_KPI} files per KPI.`);
    }

    const duplicate = await tx.attachment.findUnique({
      where: { submissionId_checksum: { submissionId: submission!.id, checksum } },
    });
    if (duplicate) {
      throw new ApiError(409, 'This exact file is already attached to this KPI.');
    }

    const { inlineData } = await putFile(storageKey, buffer, file.type || 'application/octet-stream');
    const attachment = await tx.attachment.create({
      data: {
        submissionId: submission!.id,
        originalFileName: file.name,
        storageKey,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        checksum,
        data: inlineData,
        uploadedByUserId: ctx.user.id,
      },
    });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'ATTACHMENT_UPLOADED',
      entityType: 'Attachment',
      entityId: attachment.id,
      newValues: { fileName: file.name, size: file.size, kpi: assignment.kpi.kpiCode, month },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
    return attachment;
  });

  return NextResponse.json({
    ok: true,
    attachment: {
      id: result.id,
      originalFileName: result.originalFileName,
      fileSize: result.fileSize,
      uploadedAt: result.uploadedAt,
    },
  });
});
