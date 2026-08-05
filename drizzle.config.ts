import { defineConfig } from 'drizzle-kit';
import { databaseFile } from './src/server/db/paths';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dbCredentials: { url: databaseFile() },
  strict: true,
  verbose: true,
});
