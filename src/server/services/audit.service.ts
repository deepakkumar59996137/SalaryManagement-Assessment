import type { AppDatabase } from '../db/client';
import {
  type AuditFilters,
  type AuditListRow,
  countAuditEntries,
  findAuditEntries,
} from '../repositories/audit.repository';

/**
 * The audit trail.
 *
 * Read-only by design — nothing in the application updates or deletes an
 * entry, which is what makes it worth anything.
 */

export const AUDIT_PAGE_SIZE = 50;

export interface AuditPage {
  readonly entries: readonly AuditListRow[];
  readonly total: number;
  readonly page: number;
  readonly totalPages: number;
  readonly pageSize: number;
}

export function listAuditEntries(
  db: AppDatabase,
  filters: AuditFilters = {},
  page = 1,
  pageSize = AUDIT_PAGE_SIZE,
): AuditPage {
  const total = countAuditEntries(db, filters);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);

  return {
    entries: findAuditEntries(db, filters, pageSize, (current - 1) * pageSize),
    total,
    page: current,
    totalPages,
    pageSize,
  };
}

export type { AuditFilters, AuditListRow };
