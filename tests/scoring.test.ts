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

describe('U scoring (higher is better)', () => {
  it('Actual/Target*100', () => {
    expect(computeScore({ variance: 'U', actual: 79, target: 90 })).toBe(87.78);
  });
  it('caps at 100 by default', () => {
    expect(computeScore({ variance: 'U', actual: 120, target: 100 })).toBe(100);
  });
  it('honours a higher score cap', () => {
    expect(computeScore({ variance: 'U', actual: 120, target: 100, scoreCap: 150 })).toBe(120);
  });
  it('never goes below 0', () => {
    expect(computeScore({ variance: 'U', actual: -5, target: 100 })).toBe(0);
  });
});

describe('D scoring (lower is better)', () => {
  it('Target/Actual*100', () => {
    expect(computeScore({ variance: 'D', actual: 6, target: 4 })).toBe(66.67);
  });
  it('zero actual = 100 when zeroActualIsPerfect', () => {
    expect(computeScore({ variance: 'D', actual: 0, target: 4, zeroActualIsPerfect: true })).toBe(100);
  });
  it('zero actual = capped best score otherwise', () => {
    expect(computeScore({ variance: 'D', actual: 0, target: 4 })).toBe(100);
    expect(computeScore({ variance: 'D', actual: 0, target: 4, scoreCap: 120 })).toBe(120);
  });
  it('caps overshoot', () => {
    expect(computeScore({ variance: 'D', actual: 1, target: 4 })).toBe(100);
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
