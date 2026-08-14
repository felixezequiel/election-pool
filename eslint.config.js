import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-*/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
      // Astro: artefatos GERADOS e config/scripts em .mjs (não são projeto TS
      // type-checked — o apps/web tem seu próprio lint `lint-num`). O root eslint
      // é type-checked (projectService) e só deve cobrir o TS de fonte.
      'apps/web/.astro/**',
      'apps/web/src/env.d.ts',
      '**/*.mjs',
      // Migrations rodam via `node-pg-migrate --tsx` (não são compiladas pelo repo
      // e seus tipos vêm do node_modules do apps/api, não resolvíveis a partir de
      // infra/). São exercidas de ponta a ponta pelos testes de integração; não as
      // submetemos ao eslint type-checked do root.
      'infra/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value='./index'] ",
          message: 'No barrel files: import directly from the source module.',
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
