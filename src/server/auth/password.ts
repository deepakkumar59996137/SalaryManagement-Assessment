import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * Deliberately no dependency: bcrypt and argon2 are both native modules, and
 * adding a second thing that has to compile on the deployment host — for one
 * seeded account — is a poor trade. scrypt is memory-hard, in core since Node 10,
 * and the OWASP-recommended fallback where argon2 is unavailable.
 *
 * Stored format is `salt:derivedKey`, both hex.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export function hashPassword(password: string, salt = randomBytes(SALT_BYTES).toString('hex')): string {
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Compares in constant time, so the response cannot leak how much of the hash
 * matched. Malformed stored values return false rather than throwing — a
 * corrupt row should fail the login, not the request.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const separator = stored.indexOf(':');
  if (separator <= 0) return false;

  const salt = stored.slice(0, separator);
  const expectedHex = stored.slice(separator + 1);
  if (expectedHex.length === 0) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }

  if (expected.length !== KEY_LENGTH) return false;

  const derived = scryptSync(password, salt, KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}
