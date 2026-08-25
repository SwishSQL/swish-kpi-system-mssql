import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { readWorkbook, EXECUTORS, IMPORT_ORDER, FIELD_DEFS, ImportType } from '@/lib/importer';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const configSchema = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
  allowProfileWithoutEmail: z.boolean().optional(),
  createMissingDepartments: z.boolean().optional(),
  createMissingKpis: z.boolean().optional(),
  sheets: z
    .array(
      z.object({
        sheet: z.string(),
        importType: z.enum(['departments', 'employees', 'kpi_library', 'assignments', 'submissions', 'skip']),
        mode: z.enum(['insert', 'update', 'upsert']).default('upsert'),
        mapping: z.record(z.string(), z.string()).default({}),
      })
    )
    .min(1),
});

/**
 * Step 2 of the Import Wizard: re-upload the workbook together with the
 * confirmed mappings; sheets run in dependency order, each in its own
 * transaction, producing an ImportJob record + downloadable error report.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'imports.run');

  const form = await req.formData();
  const file = form.get('file');
  const configRaw = form.get('config');
  if (!(file instanceof File)) throw new ApiError(400, 'file is required.');
  if (typeof configRaw !== 'string') throw new ApiError(400, 'config is required.');
  const config = configSchema.parse(JSON.parse(configRaw));

  const buffer = Buffer.from(await file.arrayBuffer());
  const sheets = readWorkbook(buffer);
  const sheetMap = new Map(sheets.map((s) => [s.name, s]));

  // Validate mappings up front
  for (const sc of config.sheets) {
    if (sc.importType === 'skip') continue;
    const sheet = sheetMap.get(sc.sheet);
    if (!sheet) throw new ApiError(400, `Sheet "${sc.sheet}" not found in the workbook.`);
    const defs = FIELD_DEFS[sc.importType];
    const missing = defs.filter((d) => d.required && !sc.mapping[d.field]);
    if (missing.length) {
      throw new ApiError(
        400,
        `Sheet "${sc.sheet}": missing required column mapping for ${missing.map((m) => m.label).join(', ')}.`
      );
    }
    for (const header of Object.values(sc.mapping)) {
      if (header && !sheet.headers.includes(header)) {
        throw new ApiError(400, `Sheet "${sc.sheet}": mapped column "${header}" does not exist.`);
      }
    }
  }

  const ordered = [...config.sheets].sort(
    (a, b) =>
      IMPORT_ORDER.indexOf(a.importType as any) - IMPORT_ORDER.indexOf(b.importType as any)
  );

  const results: any[] = [];
  for (const sc of ordered) {
    if (sc.importType === 'skip') continue;
    const sheet = sheetMap.get(sc.sheet)!;
    const job = await db.importJob.create({
      data: {
        fileName: file.name,
        importType: sc.importType,
        workbookSheetName: sc.sheet,
        status: 'RUNNING',
        totalRows: sheet.rows.length,
        uploadedByUserId: ctx.user.id,
      },
    });
    try {
      const result = await EXECUTORS[sc.importType as Exclude<ImportType, 'unknown'>](sheet, sc.mapping, {
        mode: sc.mode,
        year: config.year ?? new Date().getFullYear(),
        allowProfileWithoutEmail: config.allowProfileWithoutEmail ?? false,
        createMissingDepartments: config.createMissingDepartments ?? true,
        createMissingKpis: config.createMissingKpis ?? true,
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
      results.push({ sheet: sc.sheet, importType: sc.importType, jobId: job.id, ...result });
    } catch (err: any) {
      await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorReport: JSON.stringify([{ row: 0, error: String(err?.message || err), severity: 'error' }]),
          completedAt: new Date(),
        },
      });
      results.push({
        sheet: sc.sheet,
        importType: sc.importType,
        jobId: job.id,
        total: sheet.rows.length,
        valid: 0,
        failed: sheet.rows.length,
        errors: [{ row: 0, error: `Sheet failed: ${String(err?.message || err)}`, severity: 'error' }],
        summary: '{}',
      });
    }
  }

  await logAudit(db, {
    userId: ctx.user.id,
    action: 'IMPORT_EXECUTED',
    entityType: 'ImportJob',
    entityId: file.name,
    newValues: {
      sheets: results.map((r) => ({ sheet: r.sheet, type: r.importType, valid: r.valid, failed: r.failed })),
    },
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });

  return NextResponse.json({ ok: true, results });
});
