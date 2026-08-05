import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * Deliberately no dependency: bcrypt and argon2 are both native modules, and
 * adding a second thing that has to compile on the deployment host — for one
 * seeded account — is a poor trade. scrypt is memory-hard, in core since Node 10,
 * and the OWASP-recommended choice where argon2 is unavailable.
 *
 * The stored format carries the cost parameters that produced it:
 *
 *     scrypt$16384$8$1$<saltHex>$<keyHex>
 *
 * Verification reads the parameters back out of the hash rather than assuming
 * today's constants. That means the cost can be raised later without
 * invalidating every existing password, and it lets tests use a cheap cost
 * without weakening the real one.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export interface ScryptParameters {
  /** CPU/memory cost. Must be a power of two. Memory used is 128 × N × r bytes. */
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** OWASP's recommended scrypt minimum: 16 MiB of memory per hash, ~100ms. */
export const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = { N: 16_384, r: 8, p: 1 };

/**
 * Cheap parameters for tests only.
 *
 * A test suite that hashes fifty times should not spend five seconds proving
 * that scrypt is slow. Never use these for a stored credential.
 */
export const TEST_SCRYPT_PARAMETERS: ScryptParameters = { N: 256, r: 8, p: 1 };

export interface HashOptions {
  readonly salt?: string;
  readonly parameters?: ScryptParameters;
}

function derive(password: string, salt: string, parameters: ScryptParameters): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    // scrypt needs 128 × N × r bytes; Node's 32 MiB default is not enough headroom.
    maxmem: 256 * parameters.N * parameters.r,
  });
}

export function hashPassword(password: string, options: HashOptions = {}): string {
  const {
    salt = randomBytes(SALT_BYTES).toString('hex'),
    parameters = DEFAULT_SCRYPT_PARAMETERS,
  } = options;

  const key = derive(password, salt, parameters).toString('hex');
  return `scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt}$${key}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Compares in constant time, so a response cannot leak how much of the hash
 * matched. A malformed stored value returns false rather than throwing — a
 * corrupt row should fail the login, not the request.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, salt, expectedHex] = parts as [string, string, string, string, string, string];

  const parameters = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  const parametersValid =
    Number.isInteger(parameters.N) && parameters.N > 1 && (parameters.N & (parameters.N - 1)) === 0 &&
    Number.isInteger(parameters.r) && parameters.r > 0 &&
    Number.isInteger(parameters.p) && parameters.p > 0;

  if (!parametersValid || salt.length === 0 || expectedHex.length !== KEY_LENGTH * 2) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  return timingSafeEqual(derive(password, salt, parameters), expected);
}
