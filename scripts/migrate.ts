/**
 * Apply pending migrations to the configured database.
 *
 * Run directly (`npm run db:migrate`) or via scripts/boot.ts on startup.
 */
import fs from 'node:fs';
import { getConnection, runMigrations } from '../src/server/db/client';
import { databaseDirectory, databaseFile } from '../src/server/db/paths';

fs.mkdirSync(databaseDirectory(), { recursive: true });

const connection = getConnection();
runMigrations(connection);

console.log(`Migrations applied to ${databaseFile()}`);
connection.close();
