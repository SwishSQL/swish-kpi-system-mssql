import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { readWorkbook, guessMapping, EXECUTORS, FIELD_DEFS, ImportType } from '@/lib/importer';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ALLOWED = ['employees', 'kpi_library', 'assignments'] as const;

const OWNING_PERMISSION: Record<(typeof ALLOWED)[number], string> = {
  employees: 'users.create',
  kpi_library: 'kpi_library.manage',
  assignments: 'kpi_assignments.manage',
};

/**
 * One-step upload for a file filled in from the matching template. The full
 * Import Wizard still exists for unknown workbooks; this skips its mapping step
 * because the template's headers are already the ones the importer looks for.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'imports.run');

  const form = await req.formData();
  const file = form.get('file');
  const type = String(form.get('type') || '') as (typeof ALLOWED)[number];
  const mode = (String(form.get('mode') || 'upsert') as 'insert' | 'update' | 'upsert');

  if (!(file instanceof File)) throw new ApiError(400, 'Choose a file first.');
  if (!ALLOWED.includes(type)) throw new ApiError(400, 'Unsupported import type.');
  if (file.size > 25 * 1024 * 1024) throw new ApiError(400, 'File exceeds 25 MB.');
  requirePerm(ctx, OWNING_PERMISSION[type]);

  let sheets;
  try {
    sheets = readWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch {
    throw new ApiError(400, 'Could not read that file. Save it as .csv or .xlsx and try again.');
  }
  const populated = sheets.filter((s) => s.rows.length > 0);
  if (populated.length === 0) throw new ApiError(400, 'The file has no data rows.');

  // A workbook often opens on a cover or notes sheet, so pick the first one
  // whose columns actually match rather than simply the first with content.
  const required = FIELD_DEFS[type].filter((d) => d.required);
  const candidates = populated.map((s) => {
    const mapping = guessMapping(type, s.headers);
    return { sheet: s, mapping, missing: required.filter((d) => !mapping[d.field]) };
  });
  const chosen = candidates.find((c) => c.missing.length === 0) ?? candidates[0];

  if (chosen.missing.length) {
    // Say what was actually read; "a column is missing" with no sight of the
    // file leaves nothing to act on.
    const found = chosen.sheet.headers.filter(Boolean).join(', ') || '(none)';
    const sheetNote = populated.length > 1 ? ` Sheet read: "${chosen.sheet.name}" of ${populated.length}.` : '';
    throw new ApiError(
      400,
      `Could not find ${chosen.missing.map((m) => m.label).join(', ')}.${sheetNote} ` +
        `Columns found were: ${found}. Download the template and keep its header row unchanged.`
    );
  }
  const sheet = chosen.sheet;
  const mapping = chosen.mapping;

  const job = await db.importJob.create({
    data: {
      fileName: file.name,
      importType: type,
      workbookSheetName: sheet.name,
      status: 'RUNNING',
      totalRows: sheet.rows.length,
      uploadedByUserId: ctx.user.id,
    },
  });

  try {
    const result = await EXECUTORS[type as Exclude<ImportType, 'unknown'>](sheet, mapping, {
      mode,
      year: new Date().getFullYear(),
      // Employees are the point of this upload, so a row without an email is a
      // blocking error rather than a silently account-less profile.
      allowProfileWithoutEmail: false,
      createMissingDepartments: false,
      // An assignment sheet naming an unknown KPI is a typo, not a new metric;
      // let it fail loudly instead of inventing a KPI with no definition.
      createMissingKpis: type !== 'assignments',
      userId: ctx.user.id,
    });

    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        validRows: result.valid,
        failedRows: result.failed,
        errorReport: JSON.stringify(result.errors),
        summary: JSON.stringify(result.summary),
        completedAt: new Date(),
      },
    });
    await logAudit(db, {
      userId: ctx.user.id,
      action: 'IMPORT_EXECUTED',
      entityType: 'ImportJob',
      entityId: job.id,
      newValues: { type, fileName: file.name, valid: result.valid, failed: result.failed },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });

    return NextResponse.json({ ok: true, jobId: job.id, ...result });
  } catch (err: any) {
    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        errorReport: JSON.stringify([{ row: 0, error: String(err?.message || err), severity: 'error' }]),
        completedAt: new Date(),
      },
    });
    throw new ApiError(400, `Import failed: ${String(err?.message || err)}`);
  }
});
