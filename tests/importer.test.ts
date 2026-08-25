import { describe, it, expect } from 'vitest';
import {
  parseNumericCell,
  parseWeightCell,
  isPercentMatrix,
  looksLikeFractionPercent,
  targetWording,
  percentPoints,
  parseVariance,
  parsePeriod,
  guessType,
  guessMapping,
} from '@/lib/importer';

const cell = (value: unknown, percent = false) => ({ value, percent });

describe('numeric cell parsing', () => {
  it('reads plain numbers unchanged', () => {
    expect(parseNumericCell(cell(90)).value).toBe(90);
    expect(parseNumericCell(cell(0.9)).value).toBe(0.9);
  });
  it('scales percentage-formatted cells to points', () => {
    expect(parseNumericCell(cell(0.9, true)).value).toBe(90);
  });
  it('reads numbers written as text', () => {
    expect(parseNumericCell(cell('95')).value).toBe(95);
    expect(parseNumericCell(cell('90%')).value).toBe(90);
  });
  it('extracts numbers from labelled text and flags the interpretation', () => {
    const r = parseNumericCell(cell('6h'));
    expect(r.value).toBe(6);
    expect(r.note).toContain('6');
    expect(parseNumericCell(cell('8 hours')).value).toBe(8);
    expect(parseNumericCell(cell('10 Checked Recipe')).value).toBe(10);
    expect(parseNumericCell(cell('>=95% accuracy')).value).toBe(95);
  });
  it('converts Excel time-only cells to decimal hours', () => {
    const time = new Date(1899, 11, 30, 2, 25, 0);
    const r = parseNumericCell(cell(time));
    expect(r.value).toBe(2.42);
    expect(r.note).toContain('02:25');
  });
  it('returns null for empty and unparseable cells', () => {
    expect(parseNumericCell(cell('')).value).toBeNull();
    expect(parseNumericCell(undefined).value).toBeNull();
    expect(parseNumericCell(cell('Every Thursday')).value).toBeNull();
    expect(parseNumericCell(cell('As per the lead time')).value).toBeNull();
  });
});

describe('weight parsing', () => {
  it('reads fractions as percentage points', () => {
    expect(parseWeightCell(cell(0.5)).value).toBe(50);
    expect(parseWeightCell(cell(0.33)).value).toBe(33);
  });
  it('reads points unchanged', () => {
    expect(parseWeightCell(cell(30)).value).toBe(30);
  });
  it('ignores percentage formatting, which workbooks apply inconsistently', () => {
    // 30 typed into a cell formatted as a percentage must stay 30, not become 3000
    expect(parseWeightCell(cell(30, true)).value).toBe(30);
    expect(parseWeightCell(cell(0.3, true)).value).toBe(30);
  });
});

describe('percentage matrices', () => {
  it('detects percentage units', () => {
    expect(isPercentMatrix('%')).toBe(true);
    expect(isPercentMatrix('QA pass rate %')).toBe(true);
    expect(isPercentMatrix('Score / 100')).toBe(true);
    expect(isPercentMatrix('Days')).toBe(false);
  });

  // The Q3 2026 workbook wrote percentage bounds as fractions while labelling
  // the Matrix column "Unit"/"Value"/blank, so the label alone cannot be trusted.
  it('recognises fraction pairs whatever the matrix label says', () => {
    expect(looksLikeFractionPercent(0.95, 0.85)).toBe(true);
    expect(looksLikeFractionPercent(1, 0.98)).toBe(true);
    expect(looksLikeFractionPercent(0.04, 0.04)).toBe(true);
    expect(looksLikeFractionPercent(0.9, null)).toBe(true);
  });
  it('leaves small counts alone', () => {
    // "2 spot checks, floor 1" and "3 preventions, floor 1" are counts, not percentages.
    expect(looksLikeFractionPercent(2, 1)).toBe(false);
    expect(looksLikeFractionPercent(3, 1)).toBe(false);
    // A target and threshold of exactly 1 is ambiguous, so it is never scaled automatically.
    expect(looksLikeFractionPercent(1, 1)).toBe(false);
    expect(looksLikeFractionPercent(100, 90)).toBe(false);
    expect(looksLikeFractionPercent(1, 500)).toBe(false);
    expect(isPercentMatrix('Unit')).toBe(false);
  });
  it('scales fractions to points and leaves points alone', () => {
    expect(percentPoints(0.9)).toEqual({ value: 90, scaled: true });
    expect(percentPoints(1)).toEqual({ value: 100, scaled: true });
    expect(percentPoints(90)).toEqual({ value: 90, scaled: false });
    expect(percentPoints(0)).toEqual({ value: 0, scaled: false });
  });
});

describe('variance parsing', () => {
  it('maps the wording used in workbooks', () => {
    expect(parseVariance('U')).toBe('U');
    expect(parseVariance('D')).toBe('D');
    expect(parseVariance('Lower is better')).toBe('D');
    expect(parseVariance('Higher is better')).toBe('U');
    expect(parseVariance('-')).toBe('U');
  });
});

describe('period parsing', () => {
  it('reads dates in local time so the month cannot slip', () => {
    expect(parsePeriod(cell(new Date(2026, 5, 30)))).toBe('2026-06');
    expect(parsePeriod(cell(new Date(2026, 6, 1)))).toBe('2026-07');
  });
  it('reads common text formats', () => {
    expect(parsePeriod(cell('2026-06'))).toBe('2026-06');
    expect(parsePeriod(cell('6/2026'))).toBe('2026-06');
    expect(parsePeriod(cell('Jun 2026'))).toBe('2026-06');
    expect(parsePeriod(cell('not a period'))).toBeNull();
  });
});

describe('sheet detection', () => {
  it('recognises the team structure sheet', () => {
    const headers = ['Employee ID', 'Employee Name', 'Department', 'Role', 'Direct Manager', 'Active', 'Emails'];
    expect(guessType(headers)).toBe('employees');
    const m = guessMapping('employees', headers);
    expect(m.employeeId).toBe('Employee ID');
    expect(m.email).toBe('Emails');
    expect(m.position).toBe('Role');
    expect(m.directManager).toBe('Direct Manager');
  });
  it('recognises the assignments sheet and its misspelled perspective column', () => {
    const headers = ['Department', 'Presptective', 'Emp. ID', 'Emp. Name', 'Position', 'Date Of Hiring',
      'KPI CODE', 'KPI', 'VARIANCE INDICATOR', 'MATRIX', 'WEIGHT', 'FREQUENCY', 'TARGET (2026)', 'Form of Submission', 'Threshold'];
    expect(guessType(headers)).toBe('assignments');
    const m = guessMapping('assignments', headers);
    expect(m.employeeId).toBe('Emp. ID');
    expect(m.perspective).toBe('Presptective');
    expect(m.target).toBe('TARGET (2026)');
    expect(m.threshold).toBe('Threshold');
  });
  it('recognises submissions and library sheets', () => {
    expect(guessType(['Record ID', 'Period', 'Employee ID', 'KPI Code', 'Actual', 'Score'])).toBe('submissions');
    expect(guessType(['KPI Code', 'KPI Name', 'Definition / Description', 'Target', 'Frequency'])).toBe('kpi_library');
  });
});

describe('shared ownership labels', () => {
  // The Q3 library names two owners for 117 of its 161 labels. Treating those
  // as departments would have grown the list from 20 to 181.
  const isShared = (s: string) => /[\/&]|\band\b/i.test(s);

  it('spots labels that name more than one owner', () => {
    expect(isShared('Central Kitchen / HR')).toBe(true);
    expect(isShared('Finance / Procurement')).toBe(true);
    expect(isShared('Warehouse & Compliance')).toBe(true);
    expect(isShared('Finance and Accounting')).toBe(true);
  });

  it('leaves genuine single departments alone', () => {
    expect(isShared('Procurement')).toBe(false);
    expect(isShared('Growth Marketing')).toBe(false);
    expect(isShared('Cost Control')).toBe(false);
  });
});

describe('target wording', () => {
  // Keeping "0.85" verbatim put it on screen beside a score computed from 85.
  it('drops a bare number, which the numeric column already holds', () => {
    expect(targetWording('0.85')).toBe('');
    expect(targetWording('1')).toBe('');
    expect(targetWording('95')).toBe('');
    expect(targetWording(' 90% ')).toBe('');
  });

  it('keeps wording a number cannot express', () => {
    expect(targetWording('≥95% accuracy & timeliness')).toBe('≥95% accuracy & timeliness');
    expect(targetWording('≤10% over 60 days')).toBe('≤10% over 60 days');
    expect(targetWording('Target per region')).toBe('Target per region');
    expect(targetWording('100% on-time')).toBe('100% on-time');
  });
});
