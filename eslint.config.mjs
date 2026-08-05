import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * Flat config, taken straight from eslint-config-next's own exports.
 *
 * Not routed through @eslint/eslintrc's FlatCompat: on ESLint 9.39 that layer
 * throws while serialising the Next plugin's config object, which contains a
 * circular reference. The native flat exports avoid the compat layer entirely.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'data/**',
      'src/server/db/migrations/**',
      'src/components/ui/**',
    ],
  },
  {
    rules: {
      // Non-null assertions are used deliberately in tests and in code guarded
      // by an immediately preceding check; the compiler's own strictness plus
      // noUncheckedIndexedAccess already cover the cases that matter.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

export default config;
