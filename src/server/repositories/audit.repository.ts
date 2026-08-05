import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { auditLog, users, type AuditEntry } from '../db/schema';

/**
 * The audit trail.
 *
 * Append-only by convention — nothing in the application updates or deletes a
 * row here. The summary is rendered at write time so the audit screen can list
 * thousands of entries without joining to whatever they refer to, and so an
 * entry still reads correctly after the employee it describes has been renamed.
 */

export interface NewAuditEntry {
  readonly actorUserId: number | null;
  readonly entity: AuditEntry['entity'];
  readonly entityId: number;
  readonly action: AuditEntry['action'];
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
  readonly summary: string;
  readonly at: string;
}

export function insertAuditEntry(db: AppDatabase, entry: NewAuditEntry): number {
  return db.insert(auditLog).values(entry).returning({ id: auditLog.id }).get().id;
}

export interface AuditFilters {
  readonly entity?: AuditEntry['entity'];
  readonly entityId?: number;
  readonly action?: AuditEntry['action'];
  readonly actorUserId?: number;
}

export interface AuditListRow {
  readonly id: number;
  readonly action: AuditEntry['action'];
  readonly entity: AuditEntry['entity'];
  readonly entityId: number;
  readonly summary: string;
  readonly at: string;
  readonly actorName: string | null;
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
}

function buildWhere(filters: AuditFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.entity) conditions.push(eq(auditLog.entity, filters.entity));
  if (filters.entityId) conditions.push(eq(auditLog.entityId, filters.entityId));
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.actorUserId) conditions.push(eq(auditLog.actorUserId, filters.actorUserId));

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function findAuditEntries(
  db: AppDatabase,
  filters: AuditFilters,
  limit: number,
  offset: number,
): AuditListRow[] {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      summary: auditLog.summary,
      at: auditLog.at,
      actorName: users.name,
      beforeJson: auditLog.beforeJson,
      afterJson: auditLog.afterJson,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(buildWhere(filters))
    // Newest first, with id as the tiebreak — several entries can share a
    // timestamp when one action writes more than one row.
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .offset(offset)
    .all() as AuditListRow[];
}

export function countAuditEntries(db: AppDatabase, filters: AuditFilters): number {
  const result = db
    .select({ total: sql<number>`count(*)` })
    .from(auditLog)
    .where(buildWhere(filters))
    .get();

  return result?.total ?? 0;
}
