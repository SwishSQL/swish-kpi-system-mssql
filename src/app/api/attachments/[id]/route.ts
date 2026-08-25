import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { canAccessProfile } from '@/lib/access';
import { getFile, deleteFile } from '@/lib/storage';
import { getPeriod, periodIsEditable } from '@/lib/submissions';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Authorized download/view endpoint (no public URLs).
 * `?mode=view` renders inline (browser opens PDFs/images in-tab instead of
 * saving them) — everything else keeps the original forced-download
 * behavior so existing links/integrations don't change.
 */
export const GET = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const attachment = await db.attachment.findUnique({
    where: { id: params.id },
    include: { submission: true },
  });
  if (!attachment) throw new ApiError(404, 'Attachment not found.');

  const canView = await canAccessProfile(ctx, attachment.submission.employeeProfileId, false);
  if (!canView) throw new ApiError(403, 'You cannot access this attachment.');

  const inline = req.nextUrl.searchParams.get('mode') === 'view';
  const buffer = await getFile(attachment);
  const safeName = attachment.originalFileName.replace(/[^\w.\- ()\[\]]/g, '_');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    },
  });
});

export const DELETE = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const attachment = await db.attachment.findUnique({
    where: { id: params.id },
    include: { submission: true },
  });
  if (!attachment) throw new ApiError(404, 'Attachment not found.');

  const canSubmit = await canAccessProfile(ctx, attachment.submission.employeeProfileId, true);
  if (!canSubmit) throw new ApiError(403, 'You cannot modify attachments for this employee.');
  if (attachment.submission.submissionStatus === 'LOCKED') {
    throw new ApiError(409, 'This submission is locked.');
  }
  const period = await getPeriod(attachment.submission.submissionMonth);
  const editable = periodIsEditable(period);
  if (!editable.editable) throw new ApiError(409, editable.reason || 'This month is not editable.');

  await db.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: attachment.id } });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'ATTACHMENT_REMOVED',
      entityType: 'Attachment',
      entityId: attachment.id,
      oldValues: { fileName: attachment.originalFileName },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });
  await deleteFile(attachment.storageKey).catch(() => {});

  return NextResponse.json({ ok: true });
});
