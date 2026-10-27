import { Prisma } from '@prisma/client';
import { db } from './db';

const CODE = /^KPI(\d+)$/i;

/**
 * The next KPI code: the highest KPI number in use, plus one.
 *
 * Codes used to be typed by whoever created the KPI, so two people picking the
 * "next" number at once collided on the unique constraint, and a stray
 * KPI1538 in the middle of a 700-odd series was enough to throw everyone off.
 * Reading the highest number in use means a code can never repeat or land on an
 * existing one; the cost is that a gap left by a deleted KPI is not refilled.
 *
 * Padded to three digits like the existing ones (KPI007), growing naturally
 * past 999. Codes that do not look like KPI<number> are ignored.
 *
 * This only proposes a number. Two creates at the same instant can read the
 * same maximum, so the caller must retry on a unique-constraint failure.
 */
export async function nextKpiCode(): Promise<string> {
  const rows = await db.kpi.findMany({ select: { kpiCode: true } });
  let max = 0;
  for (const r of rows) {
    const m = CODE.exec(r.kpiCode.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `KPI${String(max + 1).padStart(3, '0')}`;
}

/**
 * Creates a KPI under the next free code. Two creates at the same instant can
 * be handed the same number; the unique constraint turns that into an error
 * rather than a duplicate, and the loser just takes the next one.
 */
export async function createKpiWithNextCode(
  data: Omit<Prisma.KpiUncheckedCreateInput, 'kpiCode'>
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.kpi.create({ data: { ...data, kpiCode: await nextKpiCode() } });
    } catch (e: any) {
      if (e?.code !== 'P2002' || attempt >= 6) throw e;
    }
  }
}
