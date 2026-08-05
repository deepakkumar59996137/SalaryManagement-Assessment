import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../db/client';
import { resolveSession, SESSION_LIFETIME_SECONDS, type AuthenticatedUser } from '../services/auth.service';
import { UnauthorizedError } from './errors';

/**
 * The web-shaped half of authentication: cookies in, user out.
 *
 * This is the only module that imports next/headers, which is what keeps
 * auth.service.ts testable without a request.
 */

export const SESSION_COOKIE = 'salary_session';

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_LIFETIME_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Safe to call anywhere. */
export async function currentUser(): Promise<AuthenticatedUser | null> {
  return resolveSession(getDb(), await readSessionToken());
}

/**
 * For API route handlers: throws, and the handler wrapper turns it into a 401.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * For pages: sends the browser to the login screen rather than showing an error.
 *
 * The current path is passed along so signing in returns the HR Manager to
 * where they were trying to go, instead of dropping them on the dashboard.
 */
export async function requireUserOrRedirect(returnTo?: string): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (user) return user;

  const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
  redirect(target);
}
