import { NextRequest, NextResponse } from 'next/server';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { readWorkbook, guessType, guessMapping, FIELD_DEFS, asText } from '@/lib/importer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Step 1 of the Import Wizard: upload the workbook, detect sheets,
 * preview rows, suggest an import type and column mapping per sheet.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'imports.run');

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'file is required.');
  if (file.size > 25 * 1024 * 1024) throw new ApiError(400, 'Workbook exceeds 25 MB.');

  const buffer = Buffer.from(await file.arrayBuffer());
  let sheets;
  try {
    sheets = readWorkbook(buffer);
  } catch {
    throw new ApiError(400, 'Could not read the workbook. Provide a valid .xlsx/.xls/.csv file.');
  }
  if (sheets.length === 0) throw new ApiError(400, 'The workbook contains no readable sheets.');

  return NextResponse.json({
    fileName: file.name,
    fieldDefs: FIELD_DEFS,
    sheets: sheets.map((s) => {
      const type = guessType(s.headers);
      return {
        name: s.name,
        headers: s.headers,
        rowCount: s.rows.length,
        preview: s.rows.slice(0, 10).map((r) => {
          const out: Record<string, string> = {};
          for (const h of s.headers) out[h] = asText(r[h]);
          return out;
        }),
        guessedType: type,
        guessedMapping: guessMapping(type, s.headers),
      };
    }),
  });
});
