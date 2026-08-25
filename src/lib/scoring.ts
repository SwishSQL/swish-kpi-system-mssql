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

export interface ScoreInput {
  variance: Variance;
  actual: number;
  target: number;
  scoreCap?: number | null;
  zeroActualIsPerfect?: boolean;
}

/**
 * U (higher is better): Score = Actual / Target * 100
 * D (lower is better):  Score = Target / Actual * 100
 * D with Actual = 0: 100 when zeroActualIsPerfect, otherwise capped best score.
 * Scores are clamped to [0, scoreCap] (default cap 100).
 */
export function computeScore(input: ScoreInput): number {
  const cap = input.scoreCap && input.scoreCap > 0 ? input.scoreCap : 100;
  let score: number;

  if (input.variance === 'U') {
    if (input.target === 0) {
      score = input.actual >= 0 ? cap : 0;
    } else {
      score = (input.actual / input.target) * 100;
    }
  } else {
    if (input.actual === 0) {
      score = input.zeroActualIsPerfect ? 100 : cap;
    } else if (input.target === 0) {
      score = 0;
    } else {
      score = (input.target / input.actual) * 100;
    }
  }

  if (!Number.isFinite(score) || score < 0) score = 0;
  if (score > cap) score = cap;
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
