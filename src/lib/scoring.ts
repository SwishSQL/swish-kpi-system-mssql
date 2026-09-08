export type Variance = 'U' | 'D';

export type PerfStatus =
  | 'TARGET_ACHIEVED'
  | 'BETWEEN_TARGET_AND_THRESHOLD'
  | 'BELOW_THRESHOLD';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/**
 * Percentage KPIs are stored as percentage points (0-100).
 * Manual input is taken literally: 79 -> 79%, 1 -> 1% (never 100%).
 */
export function normalizeManualInput(value: number): number {
  return round2(value);
}

/**
 * Excel import normalization:
 * - Cell explicitly percentage-formatted with raw value 0.90 -> 90
 * - Cell containing plain 90 -> 90
 */
export function normalizeExcelValue(raw: number, isPercentFormatted: boolean): number {
  if (isPercentFormatted) return round2(raw * 100);
  return round2(raw);
}

export type MatrixType = 'UNIT' | 'TIME' | 'PERCENTAGE';

export interface ScoreInput {
  variance: Variance;
  actual: number;
  target: number;
  matrixType?: MatrixType;
}

/**
 * A Percentage-matrix KPI's actual value already IS a percentage of
 * completion or quality, so the score is read off it directly rather than
 * divided by a target - 92% accuracy scores 92, not "92 vs a 95 target".
 * D-type (lower is better) is inverted so the direction still means what it
 * says: an Abandoned Call Rate of 2% (excellent) scores 98, not 2 - a KPI
 * marked "lower is better" must not reward a lower score for better results.
 *
 * Unit/Time KPIs keep the ratio this system has always used:
 *   U (higher is better): Score = Actual / Target * 100
 *   D (lower is better):  Score = Target / Actual * 100
 *   D with Actual = 0: scores 100 (nothing recorded against a lower-is-better
 *   measure reads as a perfect result).
 * Scores are clamped to [0, 100].
 */
export function computeScore(input: ScoreInput): number {
  let score: number;

  if (input.matrixType === 'PERCENTAGE') {
    score = input.variance === 'U' ? input.actual : 100 - input.actual;
  } else if (input.variance === 'U') {
    if (input.target === 0) {
      score = input.actual >= 0 ? 100 : 0;
    } else {
      score = (input.actual / input.target) * 100;
    }
  } else {
    if (input.actual === 0) {
      score = 100;
    } else if (input.target === 0) {
      score = 0;
    } else {
      score = (input.target / input.actual) * 100;
    }
  }

  if (!Number.isFinite(score) || score < 0) score = 0;
  if (score > 100) score = 100;
  return round2(score);
}

/**
 * U: Actual >= Target -> achieved; Actual >= Threshold -> between; else below.
 * D: Actual <= Target -> achieved; Actual <= Threshold -> between; else below.
 */
export function performanceStatus(
  variance: Variance,
  actual: number,
  target: number,
  threshold: number
): PerfStatus {
  if (variance === 'U') {
    if (actual >= target) return 'TARGET_ACHIEVED';
    if (actual >= threshold) return 'BETWEEN_TARGET_AND_THRESHOLD';
    return 'BELOW_THRESHOLD';
  }
  if (actual <= target) return 'TARGET_ACHIEVED';
  if (actual <= threshold) return 'BETWEEN_TARGET_AND_THRESHOLD';
  return 'BELOW_THRESHOLD';
}

/** Weighted Score = Score x Weight. Weight in percentage points (30 = 30%). */
export function weightedScore(score: number, weight: number): number {
  return round3((score * weight) / 100);
}

export interface WeightedItem {
  score: number;
  weight: number;
}

/**
 * Employee final monthly score = sum of weighted scores.
 * weightsValid is false when active assignment weights do not total 100.
 */
export function employeeFinalScore(items: WeightedItem[]): {
  finalScore: number;
  totalWeight: number;
  weightsValid: boolean;
} {
  const totalWeight = round2(items.reduce((s, i) => s + i.weight, 0));
  const finalScore = round2(items.reduce((s, i) => s + weightedScore(i.score, i.weight), 0));
  return { finalScore, totalWeight, weightsValid: Math.abs(totalWeight - 100) < 0.001 };
}

export function distributionBucket(score: number | null): string {
  if (score === null) return 'NOT_SUBMITTED';
  if (score >= 90) return 'EXCELLENT';
  if (score >= 80) return 'GOOD';
  if (score >= 60) return 'NEEDS_IMPROVEMENT';
  return 'CRITICAL';
}
