/**
 * Prepare the database, then get out of the way.
 *
 *   npm run boot
 *
 * Runs before `next start` in production. It applies any pending migrations
 * and, if there are no employees yet, runs the deterministic seed.
 *
 * That second part exists because the demo is deployed to a free host with an
 * ephemeral filesystem: the database does not survive a spin-down, so every
 * cold start rebuilds a known-good 10,000-employee dataset rather than coming
 * up empty. Because the seed is deterministic, "rebuilt" means byte-identical.
 *
 * It is careful to be a no-op when data already exists, so mounting a real
 * volume is the only change needed to make the deployment durable — nothing
 * here would then overwrite it.
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getConnection, runMigrations } from '../src/server/db/client';
import { databaseDirectory, databaseFile } from '../src/server/db/paths';

const started = performance.now();

fs.mkdirSync(databaseDirectory(), { recursive: true });

const connection = getConnection();
runMigrations(connection);
console.log(`Migrations applied to ${databaseFile()}`);

const { employees } = connection.sqlite
  .prepare('SELECT COUNT(*) AS employees FROM employees')
  .get() as { employees: number };

if (employees > 0) {
  console.log(`Database already holds ${employees.toLocaleString('en-US')} employees — leaving it alone.`);
} else {
  console.log('Database is empty. Seeding…');
  connection.close();

  // A separate process: the seed opens its own connection and closes it, and
  // running it inline would leave this one holding a stale handle.
  const seed = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(process.cwd(), 'scripts', 'seed.ts')],
    { stdio: 'inherit', env: process.env },
  );

  if (seed.status !== 0) {
    console.error('Seeding failed — refusing to start against an empty database.');
    process.exit(1);
  }
}

console.log(`Ready in ${((performance.now() - started) / 1000).toFixed(2)}s`);
