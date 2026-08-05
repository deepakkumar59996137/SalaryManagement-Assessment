import { randomBytes } from 'node:crypto';
import { addSeconds, type Clock, systemClock } from '@/domain/dates';
import { hashPassword, verifyPassword } from '../auth/password';
import type { AppDatabase } from '../db/client';
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findUserByEmail,
  findUserBySessionToken,
} from '../repositories/auth.repository';
import { UnauthorizedError } from '../http/errors';

/**
 * Authentication. Knows nothing about cookies or requests — it takes an email
 * and a password and hands back a token, or takes a token and hands back a user.
 * The web-shaped half lives in server/http/session.ts.
 */

export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

export interface AuthenticatedUser {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly role: 'HR_MANAGER';
}

export interface SignInResult {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: AuthenticatedUser;
}

/**
 * A hash of a password nobody has, used to spend the same time verifying a
 * password for an address that does not exist as for one that does.
 *
 * Without it, a missing account returns in microseconds while a real account
 * takes scrypt's ~100ms, and the difference tells an attacker which addresses
 * are registered.
 */
const DUMMY_HASH = hashPassword(randomBytes(32).toString('hex'));

export function signIn(
  db: AppDatabase,
  credentials: { email: string; password: string },
  clock: Clock = systemClock,
): SignInResult {
  const user = findUserByEmail(db, credentials.email);
  const passwordMatches = verifyPassword(credentials.password, user?.passwordHash ?? DUMMY_HASH);

  // One message for both failure modes, so the response never confirms that an
  // address exists.
  if (!user || !passwordMatches) {
    throw new UnauthorizedError('That email and password do not match');
  }

  const now = clock.now();
  deleteExpiredSessions(db, now);

  const token = randomBytes(32).toString('base64url');
  const expiresAt = addSeconds(now, SESSION_LIFETIME_SECONDS);
  createSession(db, { id: token, userId: user.id, expiresAt, createdAt: now });

  return { token, expiresAt, user: toAuthenticatedUser(user) };
}

/** Resolve a session token to its user, or null if it is unknown or expired. */
export function resolveSession(
  db: AppDatabase,
  token: string | undefined,
  clock: Clock = systemClock,
): AuthenticatedUser | null {
  if (!token) return null;

  const user = findUserBySessionToken(db, token, clock.now());
  return user ? toAuthenticatedUser(user) : null;
}

export function signOut(db: AppDatabase, token: string | undefined): void {
  if (token) deleteSession(db, token);
}

function toAuthenticatedUser(user: {
  id: number;
  email: string;
  name: string;
  role: 'HR_MANAGER';
}): AuthenticatedUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
