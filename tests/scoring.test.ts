import { describe, it, expect } from 'vitest';
import {
  computeScore,
  performanceStatus,
  weightedScore,
  employeeFinalScore,
  normalizeManualInput,
  normalizeExcelValue,
  distributionBucket,
} from '@/lib/scoring';

describe('percentage normalization', () => {
  it('takes manual input literally (points 0-100)', () => {
    expect(normalizeManualInput(79)).toBe(79);
    expect(normalizeManualInput(98)).toBe(98);
    expect(normalizeManualInput(1)).toBe(1); // 1 means 1%, never 100%
  });
  it('multiplies percent-formatted Excel cells by 100', () => {
    expect(normalizeExcelValue(0.9, true)).toBe(90);
    expect(normalizeExcelValue(0.955, true)).toBe(95.5);
  });
  it('keeps plain Excel numbers as-is', () => {
    expect(normalizeExcelValue(90, false)).toBe(90);
    expect(normalizeExcelValue(1, false)).toBe(1);
  });
});

describe('U scoring (higher is better), Unit/Time matrix', () => {
  it('Actual/Target*100', () => {
    expect(computeScore({ variance: 'U', actual: 79, target: 90 })).toBe(87.78);
  });
  it('caps at 100', () => {
    expect(computeScore({ variance: 'U', actual: 120, target: 100 })).toBe(100);
  });
  it('never goes below 0', () => {
    expect(computeScore({ variance: 'U', actual: -5, target: 100 })).toBe(0);
  });
  it('is unaffected by matrixType when it is Unit or Time', () => {
    expect(computeScore({ variance: 'U', actual: 79, target: 90, matrixType: 'UNIT' })).toBe(87.78);
    expect(computeScore({ variance: 'U', actual: 79, target: 90, matrixType: 'TIME' })).toBe(87.78);
  });
});

describe('D scoring (lower is better), Unit/Time matrix', () => {
  it('Target/Actual*100', () => {
    expect(computeScore({ variance: 'D', actual: 6, target: 4 })).toBe(66.67);
  });
  it('zero actual always reads as a perfect result', () => {
    expect(computeScore({ variance: 'D', actual: 0, target: 4 })).toBe(100);
    expect(computeScore({ variance: 'D', actual: 0, target: 4, matrixType: 'TIME' })).toBe(100);
  });
  it('caps overshoot at 100', () => {
    expect(computeScore({ variance: 'D', actual: 1, target: 4 })).toBe(100);
  });
});

// A department head can propose a KPI as Percentage-matrix; the actual value
// IS the score rather than a ratio against target.
describe('Percentage-matrix scoring', () => {
  it('U: the actual value is the score directly, target is not involved', () => {
    expect(computeScore({ variance: 'U', actual: 92, target: 95, matrixType: 'PERCENTAGE' })).toBe(92);
    // Even a wildly different target changes nothing - this is the point.
    expect(computeScore({ variance: 'U', actual: 92, target: 10, matrixType: 'PERCENTAGE' })).toBe(92);
  });
  it('D: inverted, so a lower (better) rate scores higher', () => {
    // Abandoned Call Rate 2% (excellent) -> 98; 40% (bad) -> 60.
    expect(computeScore({ variance: 'D', actual: 2, target: 5, matrixType: 'PERCENTAGE' })).toBe(98);
    expect(computeScore({ variance: 'D', actual: 40, target: 5, matrixType: 'PERCENTAGE' })).toBe(60);
  });
  it('clamps to [0, 100] even on an out-of-range actual', () => {
    expect(computeScore({ variance: 'U', actual: 130, target: 95, matrixType: 'PERCENTAGE' })).toBe(100);
    expect(computeScore({ variance: 'D', actual: -5, target: 5, matrixType: 'PERCENTAGE' })).toBe(100);
    expect(computeScore({ variance: 'D', actual: 130, target: 5, matrixType: 'PERCENTAGE' })).toBe(0);
  });
});

describe('performance status', () => {
  it('U thresholds', () => {
    expect(performanceStatus('U', 95, 90, 80)).toBe('TARGET_ACHIEVED');
    expect(performanceStatus('U', 90, 90, 80)).toBe('TARGET_ACHIEVED');
    expect(performanceStatus('U', 85, 90, 80)).toBe('BETWEEN_TARGET_AND_THRESHOLD');
    expect(performanceStatus('U', 80, 90, 80)).toBe('BETWEEN_TARGET_AND_THRESHOLD');
    expect(performanceStatus('U', 79, 90, 80)).toBe('BELOW_THRESHOLD');
  });
  it('D thresholds', () => {
    expect(performanceStatus('D', 3, 4, 6)).toBe('TARGET_ACHIEVED');
    expect(performanceStatus('D', 4, 4, 6)).toBe('TARGET_ACHIEVED');
    expect(performanceStatus('D', 5, 4, 6)).toBe('BETWEEN_TARGET_AND_THRESHOLD');
    expect(performanceStatus('D', 6, 4, 6)).toBe('BETWEEN_TARGET_AND_THRESHOLD');
    expect(performanceStatus('D', 7, 4, 6)).toBe('BELOW_THRESHOLD');
  });
});

describe('weighted score and final score', () => {
  it('Score x Weight', () => {
    expect(weightedScore(87.78, 30)).toBe(26.334);
  });
  it('final score sums weighted scores and validates weight totals', () => {
    const r = employeeFinalScore([
      { score: 100, weight: 50 },
      { score: 80, weight: 50 },
    ]);
    expect(r.finalScore).toBe(90);
    expect(r.weightsValid).toBe(true);
  });
  it('flags weights not totalling 100', () => {
    const r = employeeFinalScore([
      { score: 100, weight: 40 },
      { score: 80, weight: 30 },
    ]);
    expect(r.weightsValid).toBe(false);
    expect(r.totalWeight).toBe(70);
  });
});

describe('distribution buckets', () => {
  it('classifies correctly', () => {
    expect(distributionBucket(95)).toBe('EXCELLENT');
    expect(distributionBucket(90)).toBe('EXCELLENT');
    expect(distributionBucket(85)).toBe('GOOD');
    expect(distributionBucket(70)).toBe('NEEDS_IMPROVEMENT');
    expect(distributionBucket(50)).toBe('CRITICAL');
    expect(distributionBucket(null)).toBe('NOT_SUBMITTED');
  });
});
