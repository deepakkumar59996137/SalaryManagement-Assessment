import fs from 'node:fs';
import path from 'node:path';
import Database, { type Database as SqliteConnection } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import { databaseDirectory, databaseFile } from './paths';

/**
 * The query-builder surface. Deliberately does not include the driver's
 * `$client`, because a transaction handle does not have one — typing it in
 * would make every repository unusable inside a transaction.
 */
export type AppDatabase = BetterSQLite3Database<typeof schema>;

/**
 * The raw driver, for the analytics repository.
 *
 * Its queries are window functions and recursive CTEs, which the builder
 * cannot express and which read better as SQL anyway. Passing the driver
 * explicitly rather than reaching through the ORM keeps that visible in the
 * signature: these functions run hand-written SQL, and they never run inside
 * a transaction.
 */
export type RawDatabase = SqliteConnection;

export interface Connection {
  readonly db: AppDatabase;
  /** The raw driver, for pragmas, transactions and the occasional hand-written query. */
  readonly sqlite: SqliteConnection;
  readonly close: () => void;
}

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');

function applyPragmas(sqlite: SqliteConnection): void {
  // Write-ahead logging: readers do not block the writer. Irrelevant for
  // in-memory databases, where SQLite quietly keeps the default.
  sqlite.pragma('journal_mode = WAL');
  // Off by default in SQLite. Without it the schema's foreign keys are decoration.
  sqlite.pragma('foreign_keys = ON');
  // Wait rather than failing immediately if another connection holds the write lock.
  sqlite.pragma('busy_timeout = 5000');

  /*
   * 64 MB of page cache. The whole database is ~7 MB at ten thousand
   * employees, so this holds all of it in memory after the first read.
   *
   * Measured, not guessed: the analytics aggregates spend most of their time
   * on random row lookups, and raising the cache from the 2 MB default took a
   * representative breakdown query from 73ms to 52ms. See docs/performance.md.
   */
  sqlite.pragma('cache_size = -64000');
}

export function openConnection(file: string): Connection {
  const sqlite = new Database(file);
  applyPragmas(sqlite);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}

/**
 * A fresh, isolated database in memory with all migrations applied.
 *
 * Used by every integration test. Because `better-sqlite3` is synchronous and
 * in-process, this costs about a millisecond — which is why the tests run
 * against a real database engine rather than a mock of one.
 */
export function openInMemory(): Connection {
  const connection = openConnection(':memory:');
  migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  return connection;
}

/** Apply any pending migrations to an existing connection. */
export function runMigrations(connection: Connection): void {
  migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
}

// ---------------------------------------------------------------------------
// Application singleton
// ---------------------------------------------------------------------------

/**
 * Cached on globalThis so Next.js hot reloads reuse one connection instead of
 * opening a new file handle on every edit.
 */
const globalForDb = globalThis as unknown as { __salaryDb?: Connection };

export function getConnection(): Connection {
  if (!globalForDb.__salaryDb) {
    fs.mkdirSync(databaseDirectory(), { recursive: true });
    globalForDb.__salaryDb = openConnection(databaseFile());
  }
  return globalForDb.__salaryDb;
}

export function getDb(): AppDatabase {
  return getConnection().db;
}

export function getRawDb(): RawDatabase {
  return getConnection().sqlite;
}

export { schema };
