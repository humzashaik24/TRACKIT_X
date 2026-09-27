// Trackit X — ESLint flat config.
// Extends the Expo shared config and layers on rules that protect the
// architectural boundaries described in docs/ARCHITECTURE.md.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'node_modules/*',
      '.expo/*',
      'coverage/*',
      'supabase/.branches/*',
      'supabase/.temp/*',
      // NOTE: `supabase/functions` is deliberately NOT ignored.
      //
      // It used to be, on the grounds that Edge Functions are Deno-targeted and
      // "type-checked by the Supabase CLI". Both halves of that are wrong now.
      // The CLI does not type-check function code — it serves it — so nothing was
      // checking it; `tsconfig.json` excludes it too. The result was that the most
      // security-sensitive code in the repository (the AI Gateway, which is the
      // only place a provider credential is ever readable) was the only code with
      // no lint and no type check.
      //
      // It is now covered by `tsconfig.edge.json` and linted by the shared config
      // below, with Deno's globals declared in the function's own `deno.d.ts`.
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // `any` is banned by the project quality standard.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'object-shorthand': ['error', 'properties'],
    },
  },
  {
    // Supabase Edge Functions.
    //
    // `no-console` allows only warn/error for the app, because a stray log in the
    // Expo bundle is noise in a user's own console. An Edge Function is the
    // opposite case: the platform captures its stdout and surfaces it as the
    // function's logs, so `console.log` IS the log sink, and refusing it would
    // leave the function unobservable in production.
    //
    // The relaxation is scoped to this directory and to the levels the function
    // actually uses; it is not a general opt-out. `logGateway` in `http.ts`
    // remains the only place in the function that calls console at all, which is
    // what keeps "no secrets in logs" reviewable in one file.
    files: ['supabase/functions/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    // UI layers must not talk to the network or the database directly.
    // All data access flows through src/services and src/features/**/api.
    files: ['app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/design-system/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase',
              message:
                'UI must not access Supabase directly. Use a service or feature repository instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // The design system is self-contained: it must not depend on features.
    files: ['src/design-system/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '@/services/*', '@/contexts/*'],
              message: 'The design system must stay independent of application features.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Reanimated's entire API is mutation of `sharedValue.value`, on purpose: the
    // write is what crosses to the UI thread. `react-hooks/immutability` models
    // React state, cannot see that, and flags every animation in the project. The
    // rule is switched off only for the animation primitives, so ordinary props
    // and state stay covered everywhere else.
    files: [
      'src/design-system/hooks/useEntrance.ts',
      'src/design-system/hooks/usePressAnimation.ts',
      'src/design-system/components/BottomSheet.tsx',
      'src/design-system/components/Modal.tsx',
      'src/design-system/components/ProgressBar.tsx',
      'src/design-system/components/Skeleton.tsx',
      'src/design-system/components/Toast.tsx',
      'src/components/marketing/AIOrbit.tsx',
    ],
    rules: {
      'react-hooks/immutability': 'off',
    },
  },
]);
