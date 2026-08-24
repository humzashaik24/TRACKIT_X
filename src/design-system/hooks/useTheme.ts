/**
 * Trackit X — theme access hooks.
 */
import { useContext } from 'react';

import { ThemeContext, type ThemeContextValue } from '../theme/ThemeProvider';
import type { Theme } from '../theme/theme';

function useThemeContext(hook: string): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error(`${hook} must be used inside a <ThemeProvider>.`);
  }
  return context;
}

/** The active theme. This is what components read. */
export function useTheme(): Theme {
  return useThemeContext('useTheme').theme;
}

/**
 * The theme *controller* — preference state and setters. Only settings screens
 * and the theme switcher need this; everything else uses `useTheme()`.
 */
export function useThemeController(): ThemeContextValue {
  return useThemeContext('useThemeController');
}
