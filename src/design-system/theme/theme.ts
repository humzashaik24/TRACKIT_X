/**
 * Trackit X — theme composition.
 *
 * A `Theme` is the complete set of values a component may read. Components never
 * import raw tokens; they call `useTheme()` and read from the theme, which is
 * what makes dark/light a runtime switch rather than a rewrite.
 *
 * Mode-dependent values (colours, gradients, shadows, chart palette) differ per
 * theme. Mode-independent values (typography, spacing, radii, motion, layers)
 * are attached to both themes so a component has exactly one source to read.
 */
import {
  avatarSize,
  controlHeight,
  darkChartColors,
  darkColors,
  darkGradients,
  darkShadows,
  iconSize,
  layers,
  layout,
  lightChartColors,
  lightColors,
  lightGradients,
  lightShadows,
  motion,
  radius,
  space,
  typography,
  type ChartColors,
  type ThemeColors,
  type ThemeGradients,
  type ThemeShadows,
} from '../tokens';

export type ThemeMode = 'dark' | 'light';

export interface Theme {
  /** Which theme is active. Prefer reading tokens over branching on this. */
  readonly mode: ThemeMode;
  /** True when the mode is dark — for the rare case a component must branch. */
  readonly isDark: boolean;
  readonly colors: ThemeColors;
  readonly gradients: ThemeGradients;
  readonly shadows: ThemeShadows;
  readonly chart: ChartColors;
  // Mode-independent tokens, carried for convenience.
  readonly typography: typeof typography;
  readonly space: typeof space;
  readonly layout: typeof layout;
  readonly radius: typeof radius;
  readonly motion: typeof motion;
  readonly layers: typeof layers;
  readonly controlHeight: typeof controlHeight;
  readonly iconSize: typeof iconSize;
  readonly avatarSize: typeof avatarSize;
}

const shared = {
  typography,
  space,
  layout,
  radius,
  motion,
  layers,
  controlHeight,
  iconSize,
  avatarSize,
} as const;

export const darkTheme: Theme = {
  mode: 'dark',
  isDark: true,
  colors: darkColors,
  gradients: darkGradients,
  shadows: darkShadows,
  chart: darkChartColors,
  ...shared,
};

export const lightTheme: Theme = {
  mode: 'light',
  isDark: false,
  colors: lightColors,
  gradients: lightGradients,
  shadows: lightShadows,
  chart: lightChartColors,
  ...shared,
};

export const themes: Record<ThemeMode, Theme> = {
  dark: darkTheme,
  light: lightTheme,
};
