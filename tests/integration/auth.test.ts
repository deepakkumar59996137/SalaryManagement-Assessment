import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '@/domain/dates';
import { hashPassword, TEST_SCRYPT_PARAMETERS, verifyPassword } from '@/server/auth/password';
import { UnauthorizedError } from '@/server/http/errors';
import { resolveSession, signIn, signOut } from '@/server/services/auth.service';
import {
  createTestContext,
  TEST_USER_EMAIL,
  TEST_USER_PASSWORD,
  type TestContext,
} from '@tests/helpers/test-db';

let context: TestContext;

beforeEach(() => {
  context = createTestContext();
});

afterEach(() => {
  context.connection.close();
});

describe('password hashing', () => {
  const cheap = { parameters: TEST_SCRYPT_PARAMETERS };

  it('accepts the right password and rejects the wrong one', () => {
    const stored = hashPassword('hunter2', cheap);
    expect(verifyPassword('hunter2', stored)).toBe(true);
    expect(verifyPassword('hunter3', stored)).toBe(false);
  });

  it('produces a different hash each time, so identical passwords are not obvious', () => {
    expect(hashPassword('hunter2', cheap)).not.toBe(hashPassword('hunter2', cheap));
  });

  it('is reproducible when the salt is supplied, which is what the seed relies on', () => {
    const options = { salt: 'fixedsalt', parameters: TEST_SCRYPT_PARAMETERS };
    expect(hashPassword('hunter2', options)).toBe(hashPassword('hunter2', options));
  });

  it('carries its cost parameters, so raising the cost later does not invalidate old hashes', () => {
    const stored = hashPassword('hunter2', cheap);
    expect(stored.startsWith(`scrypt$${TEST_SCRYPT_PARAMETERS.N}$8$1$`)).toBe(true);

    // Verified against the parameters recorded in the hash, not today's defaults.
    expect(verifyPassword('hunter2', stored)).toBe(true);
    expect(verifyPassword('hunter2', hashPassword('hunter2', { parameters: { N: 512, r: 8, p: 1 } }))).toBe(true);
  });

  it('rejects a corrupt stored value rather than throwing', () => {
    // A malformed row should fail the login, not the request.
    const key = 'a'.repeat(128);
    expect(verifyPassword('hunter2', '')).toBe(false);
    expect(verifyPassword('hunter2', 'noseparator')).toBe(false);
    expect(verifyPassword('hunter2', `scrypt$256$8$1$salt$`)).toBe(false);
    expect(verifyPassword('hunter2', `scrypt$256$8$1$salt$tooshort`)).toBe(false);
    expect(verifyPassword('hunter2', `bcrypt$256$8$1$salt$${key}`)).toBe(false);
    expect(verifyPassword('hunter2', `scrypt$256$8$1$$${key}`)).toBe(false);
  });

  it('rejects cost parameters scrypt could not have produced', () => {
    const key = 'a'.repeat(128);
    // N must be a power of two greater than 1; anything else would throw inside
    // scrypt, and a thrown error during login is a 500 rather than a rejection.
    expect(verifyPassword('hunter2', `scrypt$1000$8$1$salt$${key}`)).toBe(false);
    expect(verifyPassword('hunter2', `scrypt$0$8$1$salt$${key}`)).toBe(false);
    expect(verifyPassword('hunter2', `scrypt$256$0$1$salt$${key}`)).toBe(false);
    expect(verifyPassword('hunter2', `scrypt$abc$8$1$salt$${key}`)).toBe(false);
  });
});

describe('signIn', () => {
  it('returns a session token and the user for correct credentials', () => {
    const result = signIn(
      context.db,
      { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
      context.clock,
    );

    expect(result.user.email).toBe(TEST_USER_EMAIL);
    expect(result.user.role).toBe('HR_MANAGER');
    expect(result.token).toHaveLength(43);
    expect(result.expiresAt > context.clock.now()).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(() =>
      signIn(context.db, { email: TEST_USER_EMAIL, password: 'wrong' }, context.clock),
    ).toThrow(UnauthorizedError);
  });

  it('gives the same message for an unknown address as for a wrong password', () => {
    // Otherwise the response tells an attacker which addresses are registered.
    const unknownAddress = () =>
      signIn(context.db, { email: 'nobody@test.example', password: 'x' }, context.clock);
    const wrongPassword = () =>
      signIn(context.db, { email: TEST_USER_EMAIL, password: 'x' }, context.clock);

    let unknownMessage = '';
    let wrongMessage = '';
    try { unknownAddress(); } catch (error) { unknownMessage = (error as Error).message; }
    try { wrongPassword(); } catch (error) { wrongMessage = (error as Error).message; }

    expect(unknownMessage).toBe(wrongMessage);
    expect(unknownMessage).not.toBe('');
  });

  it('ignores case and surrounding whitespace in the email', () => {
    const result = signIn(
      context.db,
      { email: `  ${TEST_USER_EMAIL.toUpperCase()}  `, password: TEST_USER_PASSWORD },
      context.clock,
    );
    expect(result.user.email).toBe(TEST_USER_EMAIL);
  });

  it('issues a distinct token for each sign-in', () => {
    const first = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);
    const second = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);

    expect(first.token).not.toBe(second.token);
    // Signing in on a second device must not invalidate the first.
    expect(resolveSession(context.db, first.token, context.clock)).not.toBeNull();
    expect(resolveSession(context.db, second.token, context.clock)).not.toBeNull();
  });

  it('clears out sessions that have already expired', () => {
    const stale = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, fixedClock('2020-01-01'));

    signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);

    const remaining = context.sqlite
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?')
      .get(stale.token) as { n: number };
    expect(remaining.n).toBe(0);
  });
});

describe('resolveSession', () => {
  it('resolves a valid token to its user', () => {
    const { token } = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);
    expect(resolveSession(context.db, token, context.clock)?.email).toBe(TEST_USER_EMAIL);
  });

  it('refuses an unknown or absent token', () => {
    expect(resolveSession(context.db, 'not-a-real-token', context.clock)).toBeNull();
    expect(resolveSession(context.db, undefined, context.clock)).toBeNull();
    expect(resolveSession(context.db, '', context.clock)).toBeNull();
  });

  it('refuses a token whose session has expired', () => {
    const { token } = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);

    expect(resolveSession(context.db, token, context.clock)).not.toBeNull();
    // Same token, eight days later — past the seven-day lifetime.
    expect(resolveSession(context.db, token, fixedClock('2026-06-09'))).toBeNull();
  });

  it('never exposes the password hash to callers', () => {
    const { token } = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);
    const user = resolveSession(context.db, token, context.clock);

    expect(user).not.toBeNull();
    expect(Object.keys(user!)).toEqual(['id', 'email', 'name', 'role']);
  });
});

describe('signOut', () => {
  it('makes the token stop working immediately', () => {
    const { token } = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);

    signOut(context.db, token);

    expect(resolveSession(context.db, token, context.clock)).toBeNull();
  });

  it('leaves other sessions alone', () => {
    const phone = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);
    const laptop = signIn(context.db, { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }, context.clock);

    signOut(context.db, phone.token);

    expect(resolveSession(context.db, laptop.token, context.clock)).not.toBeNull();
  });

  it('does nothing when there is no token', () => {
    expect(() => signOut(context.db, undefined)).not.toThrow();
  });
});
