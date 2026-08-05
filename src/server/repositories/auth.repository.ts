import { and, eq, gt, lt } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { sessions, users, type User } from '../db/schema';

/**
 * Data access for users and sessions. All SQL for authentication lives here.
 */

export function findUserByEmail(db: AppDatabase, email: string): User | undefined {
  return db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).get();
}

export function findUserById(db: AppDatabase, id: number): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function createSession(
  db: AppDatabase,
  session: { id: string; userId: number; expiresAt: string; createdAt: string },
): void {
  db.insert(sessions).values(session).run();
}

/** The session's user, but only while the session is still valid. */
export function findUserBySessionToken(
  db: AppDatabase,
  token: string,
  now: string,
): User | undefined {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, now)))
    .get();
}

export function deleteSession(db: AppDatabase, token: string): void {
  db.delete(sessions).where(eq(sessions.id, token)).run();
}

/**
 * Remove sessions that have already expired.
 *
 * Called opportunistically on sign-in rather than on a schedule — this is a
 * single-process application with no job runner, and the table only grows by
 * one row per login.
 */
export function deleteExpiredSessions(db: AppDatabase, now: string): void {
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
}
