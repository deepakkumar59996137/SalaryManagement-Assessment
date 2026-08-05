import path from 'node:path';

/**
 * Location of the SQLite database file.
 *
 * Overridable via DATABASE_PATH so a deployment can point at a mounted volume
 * and scripts can target a scratch database without touching the real one.
 * Tests never call this — they use in-memory databases.
 */
export function databaseFile(): string {
  return process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'salary.db');
}

/** Directory holding the database file, created on demand at boot. */
export function databaseDirectory(): string {
  return path.dirname(databaseFile());
}
