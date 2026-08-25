/**
 * CLI workbook import — runs the exact same executors as the Import Wizard,
 * and records an ImportJob per sheet plus an audit entry, so the run appears
 * in Admin -> Import history and Admin -> Audit Log like any other import.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/import-workbook.ts <file.xlsx> <config.json> [--dry-run]
 *
 * config.json: { year, allowProfileWithoutEmail, adminEmail, sheets: [{ sheet, importType, mode, mapping }] }
 */
import fs from 'fs';
import path from 'path';
import { db } from '../src/lib/db';
import { readWorkbook, EXECUTORS, IMPORT_ORDER, FIELD_DEFS, ImportType, ExecResult } from '../src/lib/importer';
import { logAudit } from '../src/lib/audit';

async function main() {
  const [filePath, configPath] = process.argv.slice(2);
  const dryRun = process.argv.includes('--dry-run');
  if (!filePath || !configPath) {
    console.error('Usage: tsx scripts/import-workbook.ts <file.xlsx> <config.json> [--dry-run]');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sheets = readWorkbook(fs.readFileSync(filePath));
  const sheetMap = new Map(sheets.map((s) => [s.name, s]));

  console.log(`Workbook: ${path.basename(filePath)}`);
  console.log(`Sheets found: ${sheets.map((s) => `${s.name}(${s.rows.length})`).join(', ')}\n`);

  // Validate every mapping before touching the database.
  for (const sc of config.sheets) {
    if (sc.importType === 'skip') continue;
    const sheet = sheetMap.get(sc.sheet);
    if (!sheet) throw new Error(`Sheet "${sc.sheet}" not found.`);
    const defs = FIELD_DEFS[sc.importType as Exclude<ImportType, 'unknown'>];
    const missing = defs.filter((d) => d.required && !sc.mapping[d.field]);
    if (missing.length) throw new Error(`Sheet "${sc.sheet}": missing required mapping for ${missing.map((m) => m.label).join(', ')}`);
    for (const [field, header] of Object.entries(sc.mapping)) {
      if (header && !sheet.headers.includes(header as string)) {
        throw new Error(`Sheet "${sc.sheet}": mapped column "${header}" (${field}) does not exist.`);
      }
    }
  }
  console.log('All mappings validated.\n');
  if (dryRun) {
    console.log('Dry run — nothing was written.');
    return;
  }

  const admin = config.adminEmail
    ? await db.user.findUnique({ where: { email: String(config.adminEmail).toLowerCase() } })
    : await db.user.findFirst({ where: { systemRole: 'SUPER_ADMIN' } });
  if (!admin) throw new Error('No admin user found to attribute the import to.');

  const ordered = [...config.sheets]
    .filter((s: any) => s.importType !== 'skip')
    .sort((a: any, b: any) => IMPORT_ORDER.indexOf(a.importType) - IMPORT_ORDER.indexOf(b.importType));

  const results: { sheet: string; importType: string; result: ExecResult }[] = [];

  for (const sc of ordered) {
    const sheet = sheetMap.get(sc.sheet)!;
    console.log(`--- ${sc.sheet} -> ${sc.importType} (${sheet.rows.length} rows, mode=${sc.mode || 'upsert'}) ---`);
    const job = await db.importJob.create({
      data: {
        fileName: path.basename(filePath),
        importType: sc.importType,
        workbookSheetName: sc.sheet,
        status: 'RUNNING',
        totalRows: sheet.rows.length,
        uploadedByUserId: admin.id,
      },
    });
    try {
      const result = await EXECUTORS[sc.importType as Exclude<ImportType, 'unknown'>](sheet, sc.mapping, {
        mode: sc.mode || 'upsert',
        year: config.year ?? new Date().getFullYear(),
        allowProfileWithoutEmail: !!config.allowProfileWithoutEmail,
        createMissingDepartments: config.createMissingDepartments !== false,
        createMissingKpis: config.createMissingKpis !== false,
        userId: admin.id,
      });
      await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          validRows: result.valid,
          failedRows: result.failed,
          errorReport: result.errors as any,
          summary: result.summary as any,
          completedAt: new Date(),
        },
      });
      results.push({ sheet: sc.sheet, importType: sc.importType, result });
      const warnings = result.errors.filter((e) => e.severity === 'warning').length;
      console.log(`    imported=${result.valid}  failed=${result.failed}  warnings=${warnings}  ${JSON.stringify(result.summary)}`);
      for (const e of result.errors.filter((x) => x.severity === 'error').slice(0, 10)) {
        console.log(`    ERROR row ${e.row}: ${e.error}`);
      }
    } catch (err: any) {
      await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorReport: [{ row: 0, error: String(err?.message || err), severity: 'error' }] as any,
          completedAt: new Date(),
        },
      });
      console.error(`    SHEET FAILED (rolled back): ${err?.message || err}`);
      throw err;
    }
  }

  await logAudit(db, {
    userId: admin.id,
    action: 'IMPORT_EXECUTED',
    entityType: 'ImportJob',
    entityId: path.basename(filePath),
    newValues: {
      sheets: results.map((r) => ({
        sheet: r.sheet,
        type: r.importType,
        valid: r.result.valid,
        failed: r.result.failed,
      })),
    },
  });

  // Full error/warning report next to the workbook config
  const reportPath = path.join(path.dirname(configPath), 'import-report.csv');
  const lines = ['Sheet,Row,Severity,Message'];
  for (const r of results) {
    for (const e of r.result.errors) {
      lines.push(`"${r.sheet}",${e.row},${e.severity},"${String(e.error).replace(/"/g, '""')}"`);
    }
  }
  fs.writeFileSync(reportPath, '﻿' + lines.join('\r\n'), 'utf8');

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const w = r.result.errors.filter((e) => e.severity === 'warning').length;
    console.log(`${r.sheet.padEnd(18)} ${String(r.result.valid).padStart(4)} imported, ${String(r.result.failed).padStart(3)} failed, ${String(w).padStart(3)} warnings`);
  }
  console.log(`Report written to ${reportPath}`);
}

main()
  .catch((e) => {
    console.error('IMPORT ABORTED:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
