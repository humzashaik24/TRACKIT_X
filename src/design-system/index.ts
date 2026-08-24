/**
 * Trackit X — design system public surface.
 *
 * Application code imports from `@/design-system` and nothing deeper. That single
 * entry point is what lets the ESLint boundary rule work: the design system may
 * not import features, services or contexts, so anything reachable from here is
 * guaranteed free of business logic and of database access.
 */
export * from './tokens';
export * from './theme/theme';
export {
  ThemeContext,
  ThemeProvider,
  type ThemeContextValue,
  type ThemePreference,
  type ThemeProviderProps,
  type ThemeStorage,
} from './theme/ThemeProvider';
export * from './hooks';
export * from './components';
