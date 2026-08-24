/**
 * Trackit X — Jest setup.
 *
 * Runs once per test file, after the framework is installed. Its job is to make
 * the environment deterministic, not to paper over failures: nothing here
 * silences console output or swallows errors, because a warning during a test is
 * information.
 */

/**
 * `src/config/env.ts` validates configuration at import time and throws when it
 * is missing — which is correct in the app and hostile in a test run. These are
 * obviously fake values, well-formed enough to satisfy the schema, and are set
 * before any module under test is required.
 *
 * They are placeholders, not credentials. Nothing in the suite talks to a real
 * Supabase project; anything that needs a client uses a stub.
 */
process.env.EXPO_PUBLIC_APP_ENV = 'development';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key-000000000000';
process.env.EXPO_PUBLIC_DEBUG_LOGGING = 'false';

/**
 * AsyncStorage has no native module under Jest. The design system's theme
 * provider and the Supabase session store both persist through it, so a
 * lightweight in-memory double keeps those paths exercisable rather than mocked
 * out entirely.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
      getAllKeys: jest.fn(async () => [...store.keys()]),
    },
  };
});
