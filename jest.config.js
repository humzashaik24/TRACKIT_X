/**
 * Trackit X — Jest configuration.
 *
 * Uses the `jest-expo` preset so React Native / Expo modules resolve and
 * transform correctly. Pure-logic suites (tokens, validators, domain rules)
 * and component suites both run under this single project.
 */
module.exports = {
  preset: 'jest-expo',
  // Reanimated 4 pulls in react-native-worklets, whose `.native.ts` entry points
  // reach for the JSI bridge and throw under Node. This resolver ships with the
  // package and strips the native extensions for worklets modules only, which is
  // what makes any module importing an animated component loadable in a test.
  resolver: 'react-native-worklets/jest/resolver.js',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/types/database.generated.ts',
    '!src/**/index.ts',
  ],
  coverageReporters: ['text-summary', 'lcov'],
  clearMocks: true,
  restoreMocks: true,
};
