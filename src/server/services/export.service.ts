import { toCsv } from '@/domain/csv';
import { type CurrencyCode, isCurrencyCode, toMajor } from '@/domain/money';
import type { AppDatabase } from '../db/client';
import { findAllForExport } from '../repositories/import.repository';
import { IMPORT_TEMPLATE_HEADERS } from './import.service';

/**
 * CSV export.
 *
 * Money is written in major units — 92,000 rather than 9,200,000 — because the
 * destination is a spreadsheet a person will read and sort. Minor units are the
 * right storage format and the wrong export format, and an export nobody can
 * read at a glance defeats the point of offering one.
 */

const EXPORT_HEADERS = [
  'employee_code',
  'first_name',
  'last_name',
  'email',
  'job_title',
  'department',
  'level',
  'country',
  'country_code',
  'currency',
  'employment_type',
  'status',
  'hire_date',
  'manager_code',
  'base_salary',
  'annual_base_usd',
  'salary_effective_from',
  'band_min',
  'band_mid',
  'band_max',
  'compa_ratio',
  'band_position',
] as const;

const major = (minor: number | null, currency: string): string => {
  if (minor === null) return '';
  return String(toMajor(minor, isCurrencyCode(currency) ? (currency as CurrencyCode) : 'USD'));
};

export function exportEmployeesCsv(db: AppDatabase): string {
  const rows = findAllForExport(db);

  const body = rows.map((row) => {
    const compaRatio =
      row.baseSalaryMinor !== null && row.bandMidMinor !== null && row.bandMidMinor > 0
        ? (row.baseSalaryMinor / row.bandMidMinor).toFixed(3)
        : '';

    const position =
      row.baseSalaryMinor === null || row.bandMinMinor === null || row.bandMaxMinor === null
        ? ''
        : row.baseSalaryMinor < row.bandMinMinor ? 'BELOW'
        : row.baseSalaryMinor > row.bandMaxMinor ? 'ABOVE'
        : 'WITHIN';

    return [
      row.employeeCode,
      row.firstName,
      row.lastName,
      row.email,
      row.jobTitle,
      row.department,
      row.levelCode,
      row.countryName,
      row.countryCode,
      row.currency,
      row.employmentType,
      row.status,
      row.hireDate,
      row.managerCode,
      major(row.baseSalaryMinor, row.currency),
      major(row.annualBaseUsdMinor, 'USD'),
      row.effectiveFrom,
      major(row.bandMinMinor, row.currency),
      major(row.bandMidMinor, row.currency),
      major(row.bandMaxMinor, row.currency),
      compaRatio,
      position,
    ];
  });

  return toCsv([[...EXPORT_HEADERS], ...body]);
}

/**
 * An empty import file with the right headers and one worked example.
 *
 * Cheaper to hand someone the shape than to have them guess it from prose and
 * discover the mistake on upload.
 */
export function importTemplateCsv(): string {
  return toCsv([
    [...IMPORT_TEMPLATE_HEADERS],
    ['ACME-00001', '92000', '2026-04-01', 'MERIT', 'Annual review'],
  ]);
}
