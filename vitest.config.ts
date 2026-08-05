import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Path aliases mirroring tsconfig.json.
 *
 * Written out rather than derived by a plugin: it is two lines, it removes a
 * dependency, and the regexes anchor on `@/` so that scoped package names like
 * `@vitest/expect` are not caught by a bare `@` prefix match.
 */
const alias = [
  { find: /^@\//, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/` },
  { find: /^@tests\//, replacement: `${fileURLToPath(new URL('./tests', import.meta.url))}/` },
];

/**
 * Two projects, split by what they need to run.
 *
 *   unit        — pure functions from src/domain. No setup, no fixtures, no database.
 *   integration — services and repositories against a real in-memory SQLite database.
 *
 * Neither touches the network, the filesystem or the wall clock, so both are
 * deterministic by construction rather than by discipline.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
