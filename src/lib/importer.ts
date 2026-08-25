import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { hashPassword, normalizeEmail, isValidEmail } from './passwords';
import { normalizeExcelValue, computeScore, performanceStatus, weightedScore, round2 } from './scoring';
import { validateManagerAssignment } from './hierarchy';

export type ImportType = 'departments' | 'employees' | 'kpi_library' | 'assignments' | 'submissions' | 'unknown';

export interface CellValue {
  value: unknown;
  percent: boolean;
}

export interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, CellValue>[];
}

export interface RowError {
  row: number; // 1-based data row (excluding header)
  error: string;
  severity: 'error' | 'warning';
}

/** Field definitions per import type: key -> header synonyms (lowercased). */
export const FIELD_DEFS: Record<Exclude<ImportType, 'unknown'>, { field: string; label: string; required: boolean; synonyms: string[] }[]> = {
  departments: [
    { field: 'name', label: 'Department Name', required: true, synonyms: ['department', 'department name', 'name', 'dept'] },
    { field: 'code', label: 'Code', required: false, synonyms: ['code', 'dept code', 'department code'] },
    { field: 'managerEmployeeId', label: 'Department Manager (Employee ID)', required: false, synonyms: ['manager', 'department manager', 'manager id', 'dept manager'] },
  ],
  employees: [
    { field: 'employeeId', label: 'Employee ID', required: true, synonyms: ['employee id', 'emp. id', 'emp id', 'empid', 'id', 'staff id'] },
    { field: 'fullName', label: 'Full Name', required: true, synonyms: ['employee name', 'emp. name', 'emp name', 'full name', 'name', 'staff name'] },
    { field: 'email', label: 'Work Email', required: false, synonyms: ['work email', 'email', 'employee email', 'company email', 'official email', 'e-mail', 'mail'] },
    { field: 'department', label: 'Department', required: false, synonyms: ['department', 'dept'] },
    { field: 'position', label: 'Position / Role', required: false, synonyms: ['position', 'role', 'title', 'job title'] },
    { field: 'directManager', label: 'Direct Manager', required: false, synonyms: ['direct manager', 'line manager', 'manager', 'reports to', 'supervisor'] },
    { field: 'dateOfHiring', label: 'Date of Hiring', required: false, synonyms: ['date of hiring', 'hire date', 'hiring date', 'joining date', 'doh'] },
    { field: 'active', label: 'Active', required: false, synonyms: ['active', 'is active', 'status'] },
  ],
  kpi_library: [
    { field: 'kpiCode', label: 'KPI Code', required: true, synonyms: ['kpi code', 'kpi_code', 'code'] },
    { field: 'kpiName', label: 'KPI Name', required: true, synonyms: ['kpi name', 'kpi', 'name'] },
    { field: 'description', label: 'Description', required: false, synonyms: ['description', 'definition', 'definition / description', 'kpi description'] },
    { field: 'calculationMethod', label: 'Calculation Method', required: false, synonyms: ['calculation method', 'calculation', 'formula'] },
    { field: 'variance', label: 'Variance Indicator (U/D)', required: false, synonyms: ['variance indicator', 'variance', 'direction'] },
    { field: 'matrix', label: 'Matrix', required: false, synonyms: ['matrix', 'metric type', 'unit'] },
    { field: 'target', label: 'Default Target', required: false, synonyms: ['target', 'default target'] },
    { field: 'threshold', label: 'Default Threshold', required: false, synonyms: ['threshold', 'default threshold'] },
    { field: 'weight', label: 'Default Weight', required: false, synonyms: ['weight', 'default weight'] },
    { field: 'frequency', label: 'Frequency', required: false, synonyms: ['frequency', 'freq'] },
    { field: 'responsibleDept', label: 'Responsible Department', required: false, synonyms: ['responsible dept', 'responsible department', 'owner department'] },
    { field: 'formOfSubmission', label: 'Form of Submission', required: false, synonyms: ['form of submission', 'evidence', 'submission form'] },
  ],
  assignments: [
    { field: 'employeeId', label: 'Employee ID', required: true, synonyms: ['emp. id', 'emp id', 'employee id', 'empid', 'id'] },
    { field: 'employeeName', label: 'Employee Name', required: false, synonyms: ['emp. name', 'emp name', 'employee name', 'name'] },
    { field: 'department', label: 'Department', required: false, synonyms: ['department', 'dept'] },
    { field: 'perspective', label: 'Perspective', required: false, synonyms: ['perspective', 'prespective', 'presptective'] },
    { field: 'position', label: 'Position', required: false, synonyms: ['position', 'role', 'title'] },
    { field: 'dateOfHiring', label: 'Date of Hiring', required: false, synonyms: ['date of hiring', 'hire date'] },
    { field: 'kpiCode', label: 'KPI Code', required: true, synonyms: ['kpi code', 'kpi_code', 'code'] },
    { field: 'kpiName', label: 'KPI Name', required: false, synonyms: ['kpi', 'kpi name'] },
    { field: 'variance', label: 'Variance Indicator', required: false, synonyms: ['variance indicator', 'variance', 'direction'] },
    { field: 'matrix', label: 'Matrix', required: false, synonyms: ['matrix', 'unit'] },
    { field: 'weight', label: 'Weight', required: true, synonyms: ['weight'] },
    { field: 'frequency', label: 'Frequency', required: false, synonyms: ['frequency', 'freq'] },
    { field: 'target', label: 'Target', required: true, synonyms: ['target', 'target (2026)', 'target (2025)', 'target 2026', 'target 2025'] },
    { field: 'threshold', label: 'Threshold', required: false, synonyms: ['threshold'] },
    { field: 'formOfSubmission', label: 'Form of Submission', required: false, synonyms: ['form of submission', 'evidence'] },
  ],
  submissions: [
    { field: 'period', label: 'Period (YYYY-MM)', required: true, synonyms: ['period', 'month', 'submission month'] },
    { field: 'employeeId', label: 'Employee ID', required: true, synonyms: ['employee id', 'emp. id', 'emp id', 'id'] },
    { field: 'employeeName', label: 'Employee Name', required: false, synonyms: ['employee name', 'emp name', 'name'] },
    { field: 'kpiCode', label: 'KPI Code', required: true, synonyms: ['kpi code', 'code'] },
    { field: 'kpiName', label: 'KPI Name', required: false, synonyms: ['kpi name', 'kpi'] },
    { field: 'actual', label: 'Actual Result', required: true, synonyms: ['actual', 'actual result', 'result'] },
    { field: 'comment', label: 'Comment', required: false, synonyms: ['comment', 'comments', 'notes'] },
    { field: 'attachments', label: 'Attachments (reference)', required: false, synonyms: ['attachments', 'attachment', 'evidence'] },
    { field: 'submittedAt', label: 'Submitted At', required: false, synonyms: ['submitted at', 'submission date', 'date'] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function readWorkbook(buffer: Buffer): SheetData[] {
  // .xlsx is a zip (PK), legacy .xls is CFB (ÐÏ); anything else is CSV/text,
  // which XLSX.read would otherwise decode as Latin-1, mangling UTF-8.
  const isBinary =
    (buffer[0] === 0x50 && buffer[1] === 0x4b) || (buffer[0] === 0xd0 && buffer[1] === 0xcf);
  const wb = isBinary
    ? XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: true })
    : XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', cellDates: true, cellNF: true });
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);

    // find header row: first row with >= 2 non-empty cells
    let headerRow = range.s.r;
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 10); r++) {
      let filled = 0;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== undefined && String(cell.v).trim() !== '') filled++;
      }
      if (filled >= 2) {
        headerRow = r;
        break;
      }
    }

    const headers: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
      headers.push(cell && cell.v !== undefined ? String(cell.v).trim() : `Column ${c + 1}`);
    }

    const rows: Record<string, CellValue>[] = [];
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const row: Record<string, CellValue> = {};
      let hasData = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const value = cell ? cell.v : undefined;
        if (value !== undefined && String(value).trim() !== '') hasData = true;
        row[headers[c - range.s.c]] = {
          value,
          percent: !!(cell && typeof cell.z === 'string' && cell.z.includes('%')),
        };
      }
      if (hasData) rows.push(row);
    }
    sheets.push({ name, headers, rows });
  }
  return sheets;
}

export function guessType(headers: string[]): ImportType {
  const h = headers.map(norm);
  const has = (...terms: string[]) => terms.some((t) => h.some((x) => x.includes(t)));
  if (has('actual') && (has('period', 'month') || has('record id'))) return 'submissions';
  if (has('kpi') && has('emp', 'employee') && has('weight')) return 'assignments';
  if (has('kpi code', 'kpi_code') || (has('kpi') && has('definition', 'description', 'calculation'))) return 'kpi_library';
  if (has('employee id', 'emp') && has('email', 'manager', 'role', 'active')) return 'employees';
  if (has('department') && h.length <= 5) return 'departments';
  if (has('employee', 'emp')) return 'employees';
  return 'unknown';
}

export function guessMapping(type: ImportType, headers: string[]): Record<string, string> {
  if (type === 'unknown') return {};
  const mapping: Record<string, string> = {};
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  const used = new Set<string>();
  for (const def of FIELD_DEFS[type]) {
    let found: string | undefined;
    for (const syn of def.synonyms) {
      const exact = normalized.find((h) => h.n === syn && !used.has(h.raw));
      if (exact) { found = exact.raw; break; }
    }
    if (!found) {
      for (const syn of def.synonyms) {
        const partial = normalized.find((h) => h.n.includes(syn) && !used.has(h.raw));
        if (partial) { found = partial.raw; break; }
      }
    }
    if (found) {
      mapping[def.field] = found;
      used.add(found);
    }
  }
  return mapping;
}

// ---------- value helpers ----------

export function asText(cv: CellValue | undefined): string {
  if (!cv || cv.value === undefined || cv.value === null) return '';
  if (cv.value instanceof Date) return cv.value.toISOString();
  return String(cv.value).trim();
}

/**
 * Reads a numeric cell, tolerating the shapes real workbooks contain:
 *  - plain numbers and percentage-formatted cells (0.90 -> 90)
 *  - Excel time-only cells, which land on 1899-12-30 (02:25 -> 2.42 hours)
 *  - text carrying a number ("6h", "8 hours", ">=95% accuracy", "10 Checked Recipe")
 * `note` is set whenever a value had to be interpreted, so the caller can warn.
 */
export function parseNumericCell(cv: CellValue | undefined): { value: number | null; note: string | null } {
  if (!cv || cv.value === undefined || cv.value === null || cv.value === '') {
    return { value: null, note: null };
  }

  if (cv.value instanceof Date) {
    // SheetJS maps time-only cells onto the 1899 epoch date.
    if (cv.value.getFullYear() < 1900) {
      const hours =
        cv.value.getHours() + cv.value.getMinutes() / 60 + cv.value.getSeconds() / 3600;
      return {
        value: round2(hours),
        note: `time value ${String(cv.value.getHours()).padStart(2, '0')}:${String(cv.value.getMinutes()).padStart(2, '0')} read as ${round2(hours)} hours`,
      };
    }
    return { value: null, note: null };
  }

  if (typeof cv.value === 'number') {
    return { value: normalizeExcelValue(cv.value, cv.percent), note: null };
  }

  const text = String(cv.value).trim();
  const clean = text.replace(/[%,\s]/g, '');
  const direct = Number(clean);
  if (clean !== '' && Number.isFinite(direct)) {
    // "90%" written as text already means 90 percentage points
    return { value: normalizeExcelValue(direct, cv.percent && !text.includes('%')), note: null };
  }

  const found = /-?\d+(?:\.\d+)?/.exec(text);
  if (found) {
    const n = Number(found[0]);
    if (Number.isFinite(n)) return { value: round2(n), note: `text "${text}" read as ${n}` };
  }
  return { value: null, note: null };
}

export function asNumber(cv: CellValue | undefined): number | null {
  return parseNumericCell(cv).value;
}

/**
 * Reads a weight, which is always 0-100 and must ignore percentage cell
 * formatting: workbooks contain both 0.30 and 30 inside cells formatted as
 * percentages, so honouring the format would turn 30 into 3000.
 */
export function parseWeightCell(cv: CellValue | undefined): { value: number | null; note: string | null } {
  const parsed = parseNumericCell(cv ? { ...cv, percent: false } : cv);
  if (parsed.value === null) return parsed;
  if (parsed.value > 0 && parsed.value <= 1) {
    return { value: round2(parsed.value * 100), note: `weight ${parsed.value} read as ${round2(parsed.value * 100)}%` };
  }
  return parsed;
}

/** Matrix values such as "%", "QA pass rate %", "Score / 100" measure percentages. */
export function isPercentMatrix(matrix: string): boolean {
  return /%/.test(matrix) || /score\s*\/\s*100/i.test(matrix);
}

/**
 * Percentage KPIs are stored as points 0-100, but workbooks mix 0.9 and 90 for
 * the same concept. A percent value of 0 < v <= 1 is a fraction and is scaled.
 */
export function percentPoints(value: number): { value: number; scaled: boolean } {
  if (value > 0 && value <= 1) return { value: round2(value * 100), scaled: true };
  return { value, scaled: false };
}

/**
 * Recognises a percentage pair that the workbook wrote as fractions even though
 * the Matrix column says something else ("Unit", "Value", blank). Every
 * populated bound sits in (0,1] and at least one is strictly below 1.
 *
 * Count KPIs are excluded by construction: "2 spot checks, floor 1" has a
 * target above 1, so scaling never touches them.
 */
/**
 * The part of a target cell worth keeping as words. A bare number carries
 * nothing the numeric column does not already hold, and keeping it would put a
 * pre-normalization figure on screen ("0.85") beside a score computed from 85.
 */
export function targetWording(raw: string): string {
  const t = raw.trim();
  return /^\d+(\.\d+)?\s*%?$/.test(t) ? '' : t;
}

export function looksLikeFractionPercent(target: number, threshold: number | null): boolean {
  const bounds = [target, threshold].filter((v): v is number => v !== null && v !== undefined);
  if (bounds.length === 0) return false;
  return bounds.every((v) => v > 0 && v <= 1) && bounds.some((v) => v < 1);
}

export function asDate(cv: CellValue | undefined): Date | null {
  if (!cv || cv.value === undefined || cv.value === null || cv.value === '') return null;
  if (cv.value instanceof Date) return cv.value;
  const d = new Date(String(cv.value));
  return isNaN(d.getTime()) ? null : d;
}

export function asBool(cv: CellValue | undefined, fallback = true): boolean {
  const t = asText(cv).toLowerCase();
  if (!t) return fallback;
  return !['no', 'false', '0', 'inactive', 'n'].includes(t);
}

export function parseVariance(v: string): 'U' | 'D' {
  const t = v.trim().toUpperCase();
  if (t.startsWith('D') || t.includes('LOWER') || t.includes('DOWN')) return 'D';
  return 'U';
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parsePeriod(cv: CellValue | undefined): string | null {
  if (!cv || cv.value === undefined || cv.value === null) return null;
  if (cv.value instanceof Date) {
    // Local getters: SheetJS builds the date in local time, so UTC could slip a month.
    return `${cv.value.getFullYear()}-${String(cv.value.getMonth() + 1).padStart(2, '0')}`;
  }
  const t = String(cv.value).trim();
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, '0')}`;
  m = /^([A-Za-z]{3,9})[-\s]?(\d{2,4})$/.exec(t);
  if (m) {
    const month = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
    if (month) {
      const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  }
  return null;
}

// ---------- executors ----------

export interface ExecOptions {
  mode: 'insert' | 'update' | 'upsert';
  year: number;
  allowProfileWithoutEmail: boolean;
  createMissingDepartments: boolean;
  createMissingKpis: boolean;
  userId: string;
}

export interface ExecResult {
  total: number;
  valid: number;
  failed: number;
  errors: RowError[];
  summary: Record<string, number>;
}

type Tx = Prisma.TransactionClient;

async function resolveDepartment(tx: Tx, name: string, create: boolean, cache: Map<string, string | null>) {
  const key = norm(name);
  if (cache.has(key)) return cache.get(key)!;
  let dept = await tx.department.findFirst({ where: { name: { equals: name.trim() } } });
  if (!dept && create) {
    // Distinct names can normalize to the same code ("Admin / Accommodation"
    // vs "Admin/Accommodation"), and code is unique — suffix until free.
    const base = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
    let code = base;
    for (let n = 2; await tx.department.findFirst({ where: { code } }); n++) {
      code = `${base.slice(0, 30 - String(n).length - 1)}_${n}`;
    }
    dept = await tx.department.create({ data: { name: name.trim(), code } });
  }
  cache.set(key, dept?.id ?? null);
  return dept?.id ?? null;
}

export async function importDepartments(sheet: SheetData, mapping: Record<string, string>, opts: ExecOptions): Promise<ExecResult> {
  const errors: RowError[] = [];
  let valid = 0;
  let created = 0;
  let updated = 0;
  await db.$transaction(async (tx) => {
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const name = asText(row[mapping.name]);
      if (!name) {
        errors.push({ row: i + 1, error: 'Missing department name.', severity: 'error' });
        continue;
      }
      const code = asText(row[mapping.code]) || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
      const managerEmployeeId = asText(row[mapping.managerEmployeeId]) || null;
      const existing = await tx.department.findFirst({
        where: { name: { equals: name } },
      });
      if (existing) {
        if (opts.mode === 'insert') {
          errors.push({ row: i + 1, error: `Department "${name}" already exists (skipped).`, severity: 'warning' });
          continue;
        }
        await tx.department.update({
          where: { id: existing.id },
          data: { departmentManagerEmployeeId: managerEmployeeId ?? existing.departmentManagerEmployeeId },
        });
        updated++;
      } else {
        if (opts.mode === 'update') {
          errors.push({ row: i + 1, error: `Department "${name}" not found (update mode).`, severity: 'error' });
          continue;
        }
        await tx.department.create({ data: { name, code, departmentManagerEmployeeId: managerEmployeeId } });
        created++;
      }
      valid++;
    }
  }, { timeout: 120000 });
  return {
    total: sheet.rows.length,
    valid,
    failed: errors.filter((e) => e.severity === 'error').length,
    errors,
    summary: { created, updated },
  };
}

export async function importEmployees(sheet: SheetData, mapping: Record<string, string>, opts: ExecOptions): Promise<ExecResult> {
  const errors: RowError[] = [];
  let valid = 0;
  const summary: Record<string, number> = { usersCreated: 0, usersUpdated: 0, profilesOnly: 0, managersLinked: 0 };

  // Pre-validate & pre-hash passwords (bcrypt is too slow inside the transaction)
  const seenEmails = new Map<string, number>();
  const seenIds = new Map<string, number>();
  const prepared: {
    i: number; employeeId: string; fullName: string; email: string | null;
    department: string; position: string; directManager: string;
    dateOfHiring: Date | null; active: boolean; passwordHash: string | null;
  }[] = [];

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const employeeId = asText(row[mapping.employeeId]);
    const fullName = asText(row[mapping.fullName]);
    const emailRaw = asText(row[mapping.email]);
    if (!employeeId) { errors.push({ row: i + 1, error: 'Missing Employee ID.', severity: 'error' }); continue; }
    if (!fullName) { errors.push({ row: i + 1, error: `Missing name for ${employeeId}.`, severity: 'error' }); continue; }
    if (seenIds.has(employeeId)) {
      errors.push({ row: i + 1, error: `Duplicate Employee ID "${employeeId}" (first at row ${seenIds.get(employeeId)}).`, severity: 'error' });
      continue;
    }
    seenIds.set(employeeId, i + 1);

    let email: string | null = null;
    if (emailRaw) {
      email = normalizeEmail(emailRaw);
      if (!isValidEmail(email)) {
        errors.push({ row: i + 1, error: `Invalid email "${emailRaw}" for ${employeeId}.`, severity: 'error' });
        continue;
      }
      if (seenEmails.has(email)) {
        errors.push({ row: i + 1, error: `Duplicate email "${email}" (first at row ${seenEmails.get(email)}).`, severity: 'error' });
        continue;
      }
      seenEmails.set(email, i + 1);
    } else if (!opts.allowProfileWithoutEmail) {
      errors.push({ row: i + 1, error: `Missing work email for ${employeeId}. Enable "profile without login" to import anyway.`, severity: 'error' });
      continue;
    }

    prepared.push({
      i,
      employeeId,
      fullName,
      email,
      department: asText(row[mapping.department]),
      position: asText(row[mapping.position]),
      directManager: asText(row[mapping.directManager]),
      dateOfHiring: asDate(row[mapping.dateOfHiring]),
      active: asBool(row[mapping.active], true),
      // Initial temporary password = Employee ID (hashed immediately, must change on first login)
      passwordHash: email ? await hashPassword(employeeId) : null,
    });
  }

  // Preload lookups so the row loop does not pay a round trip per employee.
  const [existingUsers, existingProfiles] = await Promise.all([
    db.user.findMany({ select: { id: true, email: true, employeeId: true } }),
    db.employeeProfile.findMany({ select: { id: true, employeeId: true, userId: true } }),
  ]);
  const userByEmail = new Map(existingUsers.map((u) => [u.email, u]));
  const userByEmployeeId = new Map(existingUsers.map((u) => [u.employeeId, u]));
  const profileByEmployeeId = new Map(existingProfiles.map((p) => [p.employeeId, p]));

  await db.$transaction(async (tx) => {
    const deptCache = new Map<string, string | null>();
    const nameToId = new Map<string, string>();

    for (const p of prepared) {
      const departmentId = p.department
        ? await resolveDepartment(tx, p.department, opts.createMissingDepartments, deptCache)
        : null;
      if (p.department && !departmentId) {
        errors.push({ row: p.i + 1, error: `Department "${p.department}" not found.`, severity: 'error' });
        continue;
      }

      let userId: string | null = null;
      if (p.email) {
        const existingUser = userByEmail.get(p.email) ?? userByEmployeeId.get(p.employeeId) ?? null;
        if (existingUser) {
          if (opts.mode === 'insert') {
            errors.push({ row: p.i + 1, error: `User ${p.employeeId} already exists (skipped).`, severity: 'warning' });
          } else {
            // An account created before the import (e.g. the initial admin) may
            // carry a placeholder Employee ID. Adopt the workbook ID and move
            // the existing profile with it instead of creating a second one.
            if (existingUser.employeeId !== p.employeeId) {
              const idTaken = userByEmployeeId.get(p.employeeId);
              if (idTaken && idTaken.id !== existingUser.id) {
                errors.push({ row: p.i + 1, error: `Employee ID ${p.employeeId} belongs to another account (${idTaken.email}); row skipped.`, severity: 'error' });
                continue;
              }
              const oldProfile = existingProfiles.find((x) => x.userId === existingUser.id) ?? null;
              if (oldProfile && oldProfile.employeeId !== p.employeeId) {
                const profileTaken = profileByEmployeeId.get(p.employeeId);
                if (profileTaken) {
                  await tx.employeeProfile.update({ where: { id: oldProfile.id }, data: { userId: null } });
                } else {
                  await tx.employeeProfile.update({
                    where: { id: oldProfile.id },
                    data: { employeeId: p.employeeId },
                  });
                  profileByEmployeeId.delete(oldProfile.employeeId);
                  profileByEmployeeId.set(p.employeeId, { ...oldProfile, employeeId: p.employeeId });
                }
              }
              errors.push({
                row: p.i + 1,
                error: `Existing account ${p.email} re-linked from Employee ID ${existingUser.employeeId} to ${p.employeeId}; its system role is unchanged.`,
                severity: 'warning',
              });
            }
            await tx.user.update({
              where: { id: existingUser.id },
              data: { employeeId: p.employeeId, fullName: p.fullName, email: p.email, isActive: p.active },
            });
            summary.usersUpdated++;
          }
          userId = existingUser.id;
        } else {
          const created = await tx.user.create({
            data: {
              employeeId: p.employeeId,
              fullName: p.fullName,
              email: p.email,
              passwordHash: p.passwordHash!,
              systemRole: 'EMPLOYEE',
              mustChangePassword: true,
              isActive: p.active,
            },
          });
          userId = created.id;
          summary.usersCreated++;
        }
      } else {
        summary.profilesOnly++;
      }

      const existingProfile = profileByEmployeeId.get(p.employeeId);
      if (existingProfile) {
        await tx.employeeProfile.update({
          where: { id: existingProfile.id },
          data: {
            userId: userId ?? existingProfile.userId,
            fullName: p.fullName,
            ...(departmentId ? { departmentId } : {}),
            ...(p.position ? { position: p.position } : {}),
            ...(p.dateOfHiring ? { dateOfHiring: p.dateOfHiring } : {}),
            isActive: p.active,
          },
        });
      } else {
        const created = await tx.employeeProfile.create({
          data: {
            userId,
            employeeId: p.employeeId,
            fullName: p.fullName,
            departmentId,
            position: p.position || null,
            dateOfHiring: p.dateOfHiring,
            isActive: p.active,
          },
          select: { id: true, employeeId: true, userId: true },
        });
        profileByEmployeeId.set(p.employeeId, created);
      }
      nameToId.set(norm(p.fullName), p.employeeId);
      valid++;
    }

    // Second pass: direct managers (accepts Employee ID or full name).
    // Reports are grouped per manager so one statement links many employees.
    const allProfiles = await tx.employeeProfile.findMany({
      select: { employeeId: true, directManagerEmployeeId: true, fullName: true },
    });
    const idSet = new Set(allProfiles.map((x) => x.employeeId));
    const byName = new Map(allProfiles.map((x) => [norm(x.fullName), x.employeeId]));
    const reportsByManager = new Map<string, string[]>();

    for (const p of prepared) {
      if (!p.directManager) continue;
      let managerId: string | null = null;
      if (idSet.has(p.directManager)) managerId = p.directManager;
      else managerId = byName.get(norm(p.directManager)) ?? nameToId.get(norm(p.directManager)) ?? null;
      if (!managerId) {
        errors.push({ row: p.i + 1, error: `Direct manager "${p.directManager}" not found for ${p.employeeId}.`, severity: 'warning' });
        continue;
      }
      const current = allProfiles.map((x) => ({
        employeeId: x.employeeId,
        directManagerEmployeeId: x.employeeId === p.employeeId ? managerId : x.directManagerEmployeeId,
      }));
      const err = validateManagerAssignment(p.employeeId, managerId, current);
      if (err) {
        errors.push({ row: p.i + 1, error: `${p.employeeId}: ${err}`, severity: 'error' });
        continue;
      }
      const idx = allProfiles.findIndex((x) => x.employeeId === p.employeeId);
      if (idx >= 0) allProfiles[idx].directManagerEmployeeId = managerId;
      const arr = reportsByManager.get(managerId) ?? [];
      arr.push(p.employeeId);
      reportsByManager.set(managerId, arr);
      summary.managersLinked++;
    }

    for (const [managerId, employeeIds] of reportsByManager) {
      await tx.employeeProfile.updateMany({
        where: { employeeId: { in: employeeIds } },
        data: { directManagerEmployeeId: managerId },
      });
    }
  }, { timeout: 900000 });

  return {
    total: sheet.rows.length,
    valid,
    failed: errors.filter((e) => e.severity === 'error').length,
    errors,
    summary,
  };
}

export async function importKpiLibrary(sheet: SheetData, mapping: Record<string, string>, opts: ExecOptions): Promise<ExecResult> {
  const errors: RowError[] = [];
  let valid = 0;
  const summary: Record<string, number> = { created: 0, updated: 0 };

  // Existing codes are loaded once; per-row lookups would mean one network
  // round trip per row, which large libraries cannot afford.
  const existingKpis = await db.kpi.findMany({ select: { id: true, kpiCode: true } });
  const kpiIdByCode = new Map(existingKpis.map((k) => [k.kpiCode, k.id]));
  const kpiCodeById = new Map(existingKpis.map((k) => [k.id, k.kpiCode]));

  const toCreate: any[] = [];
  const toUpdate: { id: string; data: any }[] = [];
  const seenInSheet = new Map<string, number>();
  // Placeholder markers like "-" mean "no department", not a department named "-".
  const deptByCode = new Map<string, { name: string; row: number }>();

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const kpiCode = asText(row[mapping.kpiCode]);
    const kpiName = asText(row[mapping.kpiName]);
    if (!kpiCode) { errors.push({ row: i + 1, error: 'Missing KPI Code.', severity: 'error' }); continue; }
    if (!kpiName) { errors.push({ row: i + 1, error: `Missing KPI Name for ${kpiCode}.`, severity: 'error' }); continue; }
    if (seenInSheet.has(kpiCode)) {
      errors.push({ row: i + 1, error: `KPI ${kpiCode} appears again (first at row ${seenInSheet.get(kpiCode)}); the last row wins.`, severity: 'warning' });
    }
    seenInSheet.set(kpiCode, i + 1);

    const matrix = asText(row[mapping.matrix]);
    let defaultTarget = asNumber(row[mapping.target]);
    let defaultThreshold = asNumber(row[mapping.threshold]);

    // Defaults are copied onto every new assignment, so a fraction left here
    // would keep reintroducing the 0.95-vs-95 mismatch long after this import.
    if (
      defaultTarget !== null &&
      (isPercentMatrix(matrix) || looksLikeFractionPercent(defaultTarget, defaultThreshold))
    ) {
      const t = percentPoints(defaultTarget);
      if (t.scaled) {
        errors.push({ row: i + 1, error: `${kpiCode} default target ${defaultTarget} interpreted as ${t.value}%.`, severity: 'warning' });
        defaultTarget = t.value;
      }
      if (defaultThreshold !== null) {
        const th = percentPoints(defaultThreshold);
        if (th.scaled) {
          errors.push({ row: i + 1, error: `${kpiCode} default threshold ${defaultThreshold} interpreted as ${th.value}%.`, severity: 'warning' });
          defaultThreshold = th.value;
        }
      }
    }

    const deptName = asText(row[mapping.responsibleDept]);
    const deptText = deptName === '-' ? '' : deptName;

    const data = {
      kpiName,
      description: asText(row[mapping.description]),
      calculationMethod: asText(row[mapping.calculationMethod]),
      varianceIndicator: parseVariance(asText(row[mapping.variance]) || 'U'),
      matrix,
      defaultTarget,
      // Wording is kept only when it says something the number cannot ("<=10%
      // over 60 days"). A bare "0.85" would otherwise be shown verbatim while
      // scoring used the normalized 85 - two different targets on one row.
      targetText: targetWording(asText(row[mapping.target])),
      defaultThreshold,
      defaultWeight: asNumber(row[mapping.weight]),
      frequency: asText(row[mapping.frequency]) || 'Monthly',
      responsibleDepartmentText: deptText,
      formOfSubmission: asText(row[mapping.formOfSubmission]),
    };

    deptByCode.set(kpiCode, { name: deptText, row: i + 1 });

    const existingId = kpiIdByCode.get(kpiCode);
    if (existingId) {
      if (opts.mode === 'insert') {
        errors.push({ row: i + 1, error: `KPI ${kpiCode} already exists (skipped).`, severity: 'warning' });
        continue;
      }
      toUpdate.push({ id: existingId, data });
      summary.updated++;
    } else {
      if (opts.mode === 'update') {
        errors.push({ row: i + 1, error: `KPI ${kpiCode} not found (update mode).`, severity: 'error' });
        continue;
      }
      const idx = toCreate.findIndex((c) => c.kpiCode === kpiCode);
      if (idx >= 0) toCreate[idx] = { kpiCode, ...data };
      else { toCreate.push({ kpiCode, ...data }); summary.created++; }
    }
    valid++;
  }

  await db.$transaction(
    async (tx) => {
      const deptCache = new Map<string, string | null>();
      const resolveFor = async (kpiCode: string) => {
        const dept = deptByCode.get(kpiCode);
        if (!dept?.name) return null;

        // Ownership is routinely shared - "Central Kitchen / HR", "Finance /
        // Procurement". Those name two existing teams, not a new one, so they
        // are never created; the wording survives in responsibleDepartmentText
        // either way. Creating them would have turned 20 departments into 181
        // and filled every department filter with duplicates.
        const isShared = /[\/&]|\band\b/i.test(dept.name);
        const id = await resolveDepartment(
          tx,
          dept.name,
          opts.createMissingDepartments && !isShared,
          deptCache
        );
        if (!id) {
          errors.push({
            row: dept.row,
            error: isShared
              ? `${kpiCode} is owned jointly ("${dept.name}"); the wording is kept but no single department was linked.`
              : `Department "${dept.name}" not found; ${kpiCode} imported without a linked department.`,
            severity: 'warning',
          });
        }
        return id;
      };
      for (const c of toCreate) c.responsibleDepartmentId = await resolveFor(c.kpiCode);
      if (toCreate.length) {
        // SQL Server's createMany cannot skip duplicates - dedupe by code here.
        const seenCodes = new Set<string>();
        const uniqueCreates = toCreate.filter((c) => {
          if (seenCodes.has(c.kpiCode)) return false;
          seenCodes.add(c.kpiCode);
          return true;
        });
        await tx.kpi.createMany({ data: uniqueCreates });
      }
      for (const u of toUpdate) {
        const kpiCode = kpiCodeById.get(u.id)!;
        await tx.kpi.update({ where: { id: u.id }, data: { ...u.data, responsibleDepartmentId: await resolveFor(kpiCode) } });
      }
    },
    { timeout: 600000 }
  );

  return { total: sheet.rows.length, valid, failed: errors.filter((e) => e.severity === 'error').length, errors, summary };
}

export async function importAssignments(sheet: SheetData, mapping: Record<string, string>, opts: ExecOptions): Promise<ExecResult> {
  const errors: RowError[] = [];
  let valid = 0;
  const summary: Record<string, number> = { created: 0, updated: 0, profilesCreated: 0, kpisCreated: 0 };

  // Lookups are loaded once up front: a per-row findUnique would cost one
  // network round trip per row, which sheets of this size cannot afford.
  const [allProfiles, allKpis, allDepartments, existingAssignments] = await Promise.all([
    db.employeeProfile.findMany({ select: { id: true, employeeId: true, perspective: true } }),
    db.kpi.findMany({ select: { id: true, kpiCode: true, varianceIndicator: true, matrix: true, frequency: true, formOfSubmission: true } }),
    db.department.findMany({ select: { id: true, name: true } }),
    db.kpiAssignment.findMany({
      where: { year: opts.year, isActive: true },
      select: { id: true, employeeProfileId: true, kpiId: true },
    }),
  ]);
  const profileByEmployeeId = new Map(allProfiles.map((p) => [p.employeeId, p]));
  const kpiByCode = new Map(allKpis.map((k) => [k.kpiCode, k]));
  const deptIdByName = new Map(allDepartments.map((d) => [d.name.toLowerCase().trim(), d.id]));
  const assignmentByKey = new Map(existingAssignments.map((a) => [`${a.employeeProfileId}|${a.kpiId}`, a.id]));

  const assignmentsToCreate: any[] = [];
  const assignmentsToUpdate: { id: string; data: any }[] = [];
  const kpiVarianceFixes = new Map<string, 'U' | 'D'>();
  const kpiMatrixFixes = new Map<string, string>();
  const perspectiveFixes = new Map<string, string>();
  const newProfiles: any[] = [];
  const newKpis: any[] = [];
  const newDepartments = new Map<string, string>();
  const plannedKeys = new Set<string>();

  await db.$transaction(async (tx) => {
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const employeeId = asText(row[mapping.employeeId]);
      const kpiCode = asText(row[mapping.kpiCode]);
      if (!employeeId) { errors.push({ row: i + 1, error: 'Missing Employee ID.', severity: 'error' }); continue; }
      if (!kpiCode) { errors.push({ row: i + 1, error: `Missing KPI Code for ${employeeId}.`, severity: 'error' }); continue; }

      const matrix = asText(row[mapping.matrix]);
      const variance = parseVariance(asText(row[mapping.variance]) || 'U');
      const weightCell = parseWeightCell(row[mapping.weight]);
      const targetCell = parseNumericCell(row[mapping.target]);
      const thresholdCell = parseNumericCell(row[mapping.threshold]);

      if (weightCell.value === null) { errors.push({ row: i + 1, error: `Missing weight for ${employeeId}/${kpiCode}.`, severity: 'error' }); continue; }
      if (targetCell.value === null) {
        errors.push({ row: i + 1, error: `Target "${asText(row[mapping.target])}" for ${employeeId}/${kpiCode} is not a number.`, severity: 'error' });
        continue;
      }
      if (targetCell.note) errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} target: ${targetCell.note}.`, severity: 'warning' });
      if (thresholdCell.note) errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} threshold: ${thresholdCell.note}.`, severity: 'warning' });

      const weight = weightCell.value;
      if (weightCell.note) {
        errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} ${weightCell.note}.`, severity: 'warning' });
      }
      if (weight > 100) {
        errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} weight ${weight}% is above 100% - please review.`, severity: 'warning' });
      }

      // Percentage KPIs are stored as points 0-100; workbooks mix 0.9 and 90.
      let target = targetCell.value;
      let threshold = thresholdCell.value;
      // The Matrix column is unreliable in real workbooks - the same percentage
      // KPI arrives as "%", "Unit" or blank - so fall back to the shape of the
      // bounds themselves rather than trusting the label alone.
      if (isPercentMatrix(matrix) || looksLikeFractionPercent(target, threshold)) {
        const t = percentPoints(target);
        if (t.scaled) {
          errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} target ${target} interpreted as ${t.value}%.`, severity: 'warning' });
          target = t.value;
        }
        if (threshold !== null) {
          const th = percentPoints(threshold);
          if (th.scaled) {
            errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} threshold ${threshold} interpreted as ${th.value}%.`, severity: 'warning' });
            threshold = th.value;
          }
        }
      }
      if (threshold === null) {
        threshold = target;
        errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} has no threshold; target used instead.`, severity: 'warning' });
      }

      // A U KPI needs threshold <= target, a D KPI needs threshold >= target.
      if (variance === 'U' && threshold > target) {
        errors.push({ row: i + 1, error: `${employeeId}/${kpiCode}: threshold ${threshold} is above target ${target} for a "higher is better" KPI - please review.`, severity: 'warning' });
      }
      if (variance === 'D' && threshold < target) {
        errors.push({ row: i + 1, error: `${employeeId}/${kpiCode}: threshold ${threshold} is below target ${target} for a "lower is better" KPI - please review.`, severity: 'warning' });
      }

      let employee = profileByEmployeeId.get(employeeId);
      if (!employee) {
        const employeeName = asText(row[mapping.employeeName]);
        if (!employeeName) {
          errors.push({ row: i + 1, error: `Employee ${employeeId} not found and no name to create a profile.`, severity: 'error' });
          continue;
        }
        const deptName = asText(row[mapping.department]);
        let departmentId: string | null = null;
        if (deptName) {
          const key = deptName.toLowerCase().trim();
          departmentId = deptIdByName.get(key) ?? newDepartments.get(key) ?? null;
          if (!departmentId && opts.createMissingDepartments) {
            const created = await tx.department.create({
              data: { name: deptName.trim(), code: deptName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) },
            });
            departmentId = created.id;
            newDepartments.set(key, created.id);
          }
        }
        const created = await tx.employeeProfile.create({
          data: {
            employeeId,
            fullName: employeeName,
            departmentId,
            position: asText(row[mapping.position]) || null,
            perspective: asText(row[mapping.perspective]) || null,
            dateOfHiring: asDate(row[mapping.dateOfHiring]),
          },
          select: { id: true, employeeId: true, perspective: true },
        });
        employee = created;
        profileByEmployeeId.set(employeeId, created);
        summary.profilesCreated++;
        errors.push({ row: i + 1, error: `Employee ${employeeId} profile created without a login account (no email in this sheet).`, severity: 'warning' });
      } else if (asText(row[mapping.perspective]) && !employee.perspective) {
        perspectiveFixes.set(employee.id, asText(row[mapping.perspective]));
      }

      let kpi = kpiByCode.get(kpiCode);
      if (!kpi) {
        const kpiName = asText(row[mapping.kpiName]);
        if (!kpiName) {
          errors.push({ row: i + 1, error: `KPI ${kpiCode} not found in the library and no KPI name to create it.`, severity: 'error' });
          continue;
        }
        const created = await tx.kpi.create({
          data: {
            kpiCode,
            kpiName,
            varianceIndicator: variance,
            matrix,
            frequency: asText(row[mapping.frequency]) || 'Monthly',
            formOfSubmission: asText(row[mapping.formOfSubmission]),
          },
          select: { id: true, kpiCode: true, varianceIndicator: true, matrix: true, frequency: true, formOfSubmission: true },
        });
        kpi = created;
        kpiByCode.set(kpiCode, created);
        summary.kpisCreated++;
      } else if (asText(row[mapping.variance]) && kpi.varianceIndicator !== variance) {
        // The assignment sheet is the operational source for scoring direction;
        // KPI libraries frequently leave the variance indicator blank.
        errors.push({
          row: i + 1,
          error: `${kpiCode} scoring direction changed from ${kpi.varianceIndicator} to ${variance} based on this sheet.`,
          severity: 'warning',
        });
        kpiVarianceFixes.set(kpi.id, variance);
        kpi = { ...kpi, varianceIndicator: variance };
        kpiByCode.set(kpiCode, kpi);
        summary.varianceCorrected = (summary.varianceCorrected ?? 0) + 1;
      }
      if (matrix && !kpi.matrix) kpiMatrixFixes.set(kpi.id, matrix);

      const key = `${employee.id}|${kpi.id}`;
      const existingId = assignmentByKey.get(key);
      const data = {
        target,
        threshold,
        weight,
        frequency: asText(row[mapping.frequency]) || kpi.frequency,
        formOfSubmission: asText(row[mapping.formOfSubmission]) || kpi.formOfSubmission,
      };
      if (existingId) {
        if (opts.mode === 'insert') {
          errors.push({ row: i + 1, error: `Assignment ${employeeId}/${kpiCode}/${opts.year} already exists (skipped).`, severity: 'warning' });
          continue;
        }
        assignmentsToUpdate.push({ id: existingId, data });
        summary.updated++;
      } else if (plannedKeys.has(key)) {
        errors.push({ row: i + 1, error: `${employeeId}/${kpiCode} appears more than once in this sheet; the last row wins.`, severity: 'warning' });
        const idx = assignmentsToCreate.findIndex((a) => `${a.employeeProfileId}|${a.kpiId}` === key);
        if (idx >= 0) assignmentsToCreate[idx] = { ...assignmentsToCreate[idx], ...data };
      } else {
        plannedKeys.add(key);
        assignmentsToCreate.push({
          employeeProfileId: employee.id,
          kpiId: kpi.id,
          year: opts.year,
          effectiveFrom: new Date(Date.UTC(opts.year, 0, 1)),
          ...data,
        });
        summary.created++;
      }
      valid++;
    }

    for (const [id, varianceIndicator] of kpiVarianceFixes) {
      await tx.kpi.update({ where: { id }, data: { varianceIndicator } });
    }
    for (const [id, matrix] of kpiMatrixFixes) {
      await tx.kpi.update({ where: { id }, data: { matrix } });
    }
    for (const [id, perspective] of perspectiveFixes) {
      await tx.employeeProfile.update({ where: { id }, data: { perspective } });
    }
    if (assignmentsToCreate.length) {
      // SQL Server's createMany cannot skip duplicates - dedupe on the unique key.
      const seenAsg = new Set<string>();
      const uniqueAsg = assignmentsToCreate.filter((a: any) => {
        const key = `${a.employeeProfileId}|${a.kpiId}|${a.year}|${a.effectiveFrom}`;
        if (seenAsg.has(key)) return false;
        seenAsg.add(key);
        return true;
      });
      await tx.kpiAssignment.createMany({ data: uniqueAsg });
    }
    for (const u of assignmentsToUpdate) {
      await tx.kpiAssignment.update({ where: { id: u.id }, data: u.data });
    }
  }, { timeout: 900000 });

  return { total: sheet.rows.length, valid, failed: errors.filter((e) => e.severity === 'error').length, errors, summary };
}

export async function importSubmissions(sheet: SheetData, mapping: Record<string, string>, opts: ExecOptions): Promise<ExecResult> {
  const errors: RowError[] = [];
  let valid = 0;
  const summary: Record<string, number> = { created: 0, updated: 0, periodsCreated: 0 };
  const now = new Date();

  const [allProfiles, allKpis, allAssignments, allPeriods, existingSubs] = await Promise.all([
    db.employeeProfile.findMany({ select: { id: true, employeeId: true } }),
    db.kpi.findMany({ select: { id: true, kpiCode: true, varianceIndicator: true, scoreCap: true, zeroActualIsPerfect: true } }),
    db.kpiAssignment.findMany({ select: { id: true, employeeProfileId: true, kpiId: true, year: true, target: true, threshold: true, weight: true }, orderBy: { createdAt: 'desc' } }),
    db.submissionPeriod.findMany({ select: { year: true, month: true } }),
    db.kpiSubmission.findMany({ select: { id: true, kpiAssignmentId: true, submissionMonth: true } }),
  ]);
  const profileByEmployeeId = new Map(allProfiles.map((p) => [p.employeeId, p]));
  const kpiByCode = new Map(allKpis.map((k) => [k.kpiCode, k]));
  const assignmentByKey = new Map<string, (typeof allAssignments)[number]>();
  for (const a of allAssignments) {
    const key = `${a.employeeProfileId}|${a.kpiId}|${a.year}`;
    if (!assignmentByKey.has(key)) assignmentByKey.set(key, a);
  }
  const subByKey = new Map(existingSubs.map((s) => [`${s.kpiAssignmentId}|${s.submissionMonth}`, s.id]));

  await db.$transaction(async (tx) => {
    const periodCache = new Set(allPeriods.map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`));
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const monthKey = parsePeriod(row[mapping.period]);
      const employeeId = asText(row[mapping.employeeId]);
      const kpiCode = asText(row[mapping.kpiCode]);
      if (!monthKey) { errors.push({ row: i + 1, error: `Unreadable period "${asText(row[mapping.period])}".`, severity: 'error' }); continue; }
      if (!employeeId || !kpiCode) { errors.push({ row: i + 1, error: 'Missing Employee ID or KPI Code.', severity: 'error' }); continue; }

      const actualCell = row[mapping.actual];
      const actual = asNumber(actualCell);
      if (actual === null) { errors.push({ row: i + 1, error: `Missing/invalid actual for ${employeeId}/${kpiCode}.`, severity: 'error' }); continue; }

      const employee = profileByEmployeeId.get(employeeId);
      if (!employee) { errors.push({ row: i + 1, error: `Employee ${employeeId} not found.`, severity: 'error' }); continue; }
      const kpi = kpiByCode.get(kpiCode);
      if (!kpi) { errors.push({ row: i + 1, error: `KPI ${kpiCode} not found.`, severity: 'error' }); continue; }

      const year = Number(monthKey.slice(0, 4));
      const assignment = assignmentByKey.get(`${employee.id}|${kpi.id}|${year}`);
      if (!assignment) {
        errors.push({ row: i + 1, error: `No ${year} assignment of ${kpiCode} for ${employeeId}.`, severity: 'error' });
        continue;
      }

      // Ensure the period exists (historical months come in CLOSED)
      if (!periodCache.has(monthKey)) {
        const month = Number(monthKey.slice(5, 7));
        const isPast = new Date(Date.UTC(year, month, 1)) < now;
        await tx.submissionPeriod.create({
          data: { year, month, status: isPast ? 'CLOSED' : 'OPEN', opensAt: new Date(Date.UTC(year, month - 1, 1)) },
        });
        summary.periodsCreated++;
        periodCache.add(monthKey);
      }

      const score = computeScore({
        variance: kpi.varianceIndicator as 'U' | 'D',
        actual,
        target: assignment.target,
        scoreCap: kpi.scoreCap,
        zeroActualIsPerfect: kpi.zeroActualIsPerfect,
      });
      const perf = performanceStatus(kpi.varianceIndicator as 'U' | 'D', actual, assignment.target, assignment.threshold);
      const attachmentsRef = asText(row[mapping.attachments]);
      const comment = [asText(row[mapping.comment]), attachmentsRef ? `[Imported attachment reference: ${attachmentsRef}]` : '']
        .filter(Boolean)
        .join(' ');
      const submittedAt = asDate(row[mapping.submittedAt]) ?? now;
      const rawSource = actualCell?.value === undefined ? null : String(actualCell.value);

      const existingId = subByKey.get(`${assignment.id}|${monthKey}`);
      if (existingId) {
        if (opts.mode === 'insert') {
          errors.push({ row: i + 1, error: `Result for ${employeeId}/${kpiCode}/${monthKey} already exists (skipped).`, severity: 'warning' });
          continue;
        }
        await tx.kpiSubmission.update({
          where: { id: existingId },
          data: {
            actualResult: actual,
            rawSourceValue: rawSource,
            normalizedActualResult: actual,
            calculatedScore: score,
            weightedScore: weightedScore(score, assignment.weight),
            performanceStatus: perf,
            ...(comment ? { comment } : {}),
            submissionStatus: 'UPDATED',
            version: { increment: 1 },
          },
        });
        summary.updated++;
      } else {
        await tx.kpiSubmission.create({
          data: {
            employeeProfileId: employee.id,
            kpiAssignmentId: assignment.id,
            submissionMonth: monthKey,
            actualResult: actual,
            rawSourceValue: rawSource,
            normalizedActualResult: actual,
            calculatedScore: score,
            weightedScore: weightedScore(score, assignment.weight),
            submissionStatus: 'SUBMITTED',
            performanceStatus: perf,
            comment,
            submittedByUserId: opts.userId,
            submittedOnBehalfOfEmployee: true,
            submittedAt,
          },
        });
        summary.created++;
      }
      valid++;
    }
  }, { timeout: 600000 });

  return { total: sheet.rows.length, valid, failed: errors.filter((e) => e.severity === 'error').length, errors, summary };
}

export const EXECUTORS: Record<Exclude<ImportType, 'unknown'>, (s: SheetData, m: Record<string, string>, o: ExecOptions) => Promise<ExecResult>> = {
  departments: importDepartments,
  employees: importEmployees,
  kpi_library: importKpiLibrary,
  assignments: importAssignments,
  submissions: importSubmissions,
};

/** Sheets run in dependency order regardless of workbook order. */
export const IMPORT_ORDER: Exclude<ImportType, 'unknown'>[] = [
  'departments',
  'employees',
  'kpi_library',
  'assignments',
  'submissions',
];
