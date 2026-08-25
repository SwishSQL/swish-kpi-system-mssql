import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseJsonColumn } from '@/lib/audit';
import { wrap, getCtx, requirePerm } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'imports.run');
  const jobs = await db.importJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { uploadedBy: { select: { fullName: true } } },
  });
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      fileName: j.fileName,
      importType: j.importType,
      sheet: j.workbookSheetName,
      status: j.status,
      totalRows: j.totalRows,
      validRows: j.validRows,
      failedRows: j.failedRows,
      errorReport: parseJsonColumn(j.errorReport),
      summary: parseJsonColumn(j.summary),
      uploadedBy: j.uploadedBy?.fullName ?? null,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
  });
});
