// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*', 'coverage/*', 'src/types/database.ts'],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }], // use src/lib/logger.ts
      // Architecture rule: no Supabase calls in screens/components.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase',
              message: 'Call Supabase from src/features/*/api.ts only, never from screens.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/**/api.ts', 'src/lib/**', 'src/providers/**', '**/__tests__/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
]);
