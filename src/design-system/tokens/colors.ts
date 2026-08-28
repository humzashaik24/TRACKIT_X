/**
 * Trackit X — colour tokens.
 *
 * Two layers:
 *  1. `palette` — raw, theme-agnostic colour ramps. Never used directly by UI.
 *  2. `darkColors` / `lightColors` — semantic tokens consumed through
 *     `useTheme()`. UI code references meaning ("danger.fg"), never a ramp.
 *
 * The product is dark-first: the dark theme is the designed default and the
 * light theme is a faithful counterpart for daylight desktop use.
 *
 * Intent groups (accent, ai, success, warning, danger, info, neutral) all share
 * the same five-slot shape so components can switch intent without branching:
 *
 *   fg        text / icon colour when drawn straight onto the canvas
 *   surface   solid fill (filled buttons, solid badges)
 *   onSurface text colour that sits on `surface`
 *   subtle    translucent tint for chips, rows, soft containers
 *   border    border colour for `subtle` containers
 */

/** Adds an alpha channel to a 6-digit hex colour. */
export function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    throw new Error(`withAlpha expects a 6-digit hex colour, received "${hex}"`);
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

// ---------------------------------------------------------------------------
// Raw ramps
// ---------------------------------------------------------------------------

export const palette = {
  /** Cool, faintly blue-tinted neutrals — the substrate of the dark UI. */
  neutral: {
    0: '#FFFFFF',
    25: '#FBFCFD',
    50: '#F4F6F9',
    100: '#E8EBF1',
    200: '#D3D8E2',
    300: '#B0B8C6',
    400: '#828C9E',
    500: '#616B7C',
    600: '#4A5361',
    700: '#373E4A',
    800: '#252B34',
    850: '#1B2028',
    900: '#12161D',
    925: '#0D1015',
    950: '#0A0C11',
    975: '#06070A',
    1000: '#000000',
  },
  /**
   * Signal green — the brand's primary interactive colour.
   *
   * Deliberately a step yellower and far more saturated than `emerald`, which
   * carries "success". The two are adjacent on the wheel, so anything that means
   * *state* (success, warning, danger) always ships with an icon and a word as
   * well; colour alone never distinguishes "this is the action" from "this went
   * well". Used for CTAs, active navigation, focus, AI indicators and the one
   * metric a screen is about — not as a background wash.
   */
  green: {
    50: '#E9FFF1',
    100: '#C6FFDE',
    200: '#93FCC0',
    300: '#5AF79E',
    400: '#26EE7E',
    500: '#0FD265',
    600: '#08AE52',
    700: '#0A8341',
    800: '#0B6134',
    900: '#0A4526',
    950: '#052716',
  },
  /** Indigo — retained for charts and for the light theme's cool support. */
  indigo: {
    50: '#EEF1FE',
    100: '#DEE4FD',
    200: '#BFC9FB',
    300: '#9CA9F8',
    400: '#7B8BF5',
    500: '#5B6FF0',
    600: '#4453D6',
    700: '#3540B0',
    800: '#28308A',
    900: '#1D2366',
    950: '#121542',
  },
  /** Violet — reserved for AI / intelligence surfaces. */
  violet: {
    50: '#F5F0FF',
    100: '#EBE2FF',
    200: '#D6C6FF',
    300: '#BEA4FF',
    400: '#A784FB',
    500: '#9061F9',
    600: '#7A45E6',
    700: '#6534BF',
    800: '#4F2896',
    900: '#3A1D6E',
    950: '#241145',
  },
  /** Cyan — data, telemetry, live signals. */
  cyan: {
    50: '#ECFEFF',
    100: '#CFFAFE',
    200: '#A5F3FC',
    300: '#67E8F9',
    400: '#22D3EE',
    500: '#06B6D4',
    600: '#0891B2',
    700: '#0E7490',
    800: '#155E75',
    900: '#164E63',
    950: '#083344',
  },
  emerald: {
    50: '#ECFDF5',
    100: '#D1FAE5',
    200: '#A7F3D0',
    300: '#6EE7B7',
    400: '#34D399',
    500: '#10B981',
    600: '#059669',
    700: '#047857',
    800: '#065F46',
    900: '#064E3B',
    950: '#022C22',
  },
  amber: {
    50: '#FFFBEB',
    100: '#FEF3C7',
    200: '#FDE68A',
    300: '#FCD34D',
    400: '#FBBF24',
    500: '#F59E0B',
    600: '#D97706',
    700: '#B45309',
    800: '#92400E',
    900: '#78350F',
    950: '#451A03',
  },
  red: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    200: '#FECACA',
    300: '#FCA5A5',
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D',
    950: '#450A0A',
  },
  blue: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A',
    950: '#172554',
  },
} as const;

// ---------------------------------------------------------------------------
// Semantic token shape
// ---------------------------------------------------------------------------

export interface IntentColors {
  /** Text / icon colour drawn directly on the canvas. */
  readonly fg: string;
  /** Solid fill colour. */
  readonly surface: string;
  /** Text colour used on top of `surface`. */
  readonly onSurface: string;
  /** Translucent tint for soft containers. */
  readonly subtle: string;
  /** Border for soft containers. */
  readonly border: string;
}

export interface ThemeColors {
  // --- Structure -----------------------------------------------------------
  /** Root application background. */
  readonly canvas: string;
  /** Default card / panel background. */
  readonly surface: string;
  /** Card raised above another card. */
  readonly surfaceRaised: string;
  /** Modals, sheets, menus. */
  readonly surfaceOverlay: string;
  /** Recessed areas: inputs, wells, code blocks. */
  readonly surfaceInset: string;
  /** Translucent glass fill, layered over blur. */
  readonly surfaceGlass: string;
  /** Stronger glass fill for floating chrome. */
  readonly surfaceGlassStrong: string;
  /** Hover / pressed wash over any surface. */
  readonly surfaceHover: string;
  readonly surfacePressed: string;
  /** Full-screen dim behind modals. */
  readonly scrim: string;

  // --- Lines ---------------------------------------------------------------
  readonly border: string;
  readonly borderSubtle: string;
  readonly borderStrong: string;
  readonly borderFocus: string;
  /** Hairline highlight along the top edge of glass surfaces. */
  readonly sheen: string;

  // --- Content -------------------------------------------------------------
  readonly text: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly textDisabled: string;
  /** Text that sits on an inverted background. */
  readonly textInverse: string;

  // --- Intents -------------------------------------------------------------
  readonly accent: IntentColors;
  readonly ai: IntentColors;
  readonly success: IntentColors;
  readonly warning: IntentColors;
  readonly danger: IntentColors;
  readonly info: IntentColors;
  readonly neutral: IntentColors;

  // --- Feedback surfaces ---------------------------------------------------
  readonly skeleton: string;
  readonly skeletonHighlight: string;
  /** Track colour for progress bars and gauges. */
  readonly track: string;
}

// ---------------------------------------------------------------------------
// Dark theme (the designed default)
// ---------------------------------------------------------------------------

export const darkColors: ThemeColors = {
  canvas: palette.neutral[975],
  surface: '#0B0E14',
  surfaceRaised: '#12161D',
  surfaceOverlay: '#171C25',
  surfaceInset: '#080A0F',
  surfaceGlass: 'rgba(255, 255, 255, 0.045)',
  surfaceGlassStrong: 'rgba(255, 255, 255, 0.08)',
  surfaceHover: 'rgba(255, 255, 255, 0.04)',
  surfacePressed: 'rgba(255, 255, 255, 0.08)',
  scrim: 'rgba(3, 4, 6, 0.72)',

  border: 'rgba(255, 255, 255, 0.09)',
  borderSubtle: 'rgba(255, 255, 255, 0.05)',
  borderStrong: 'rgba(255, 255, 255, 0.17)',
  borderFocus: palette.green[400],
  sheen: 'rgba(255, 255, 255, 0.10)',

  text: '#F2F5F9',
  textSecondary: '#9BA5B7',
  textTertiary: '#6A7385',
  textDisabled: '#4A5261',
  textInverse: palette.neutral[975],

  accent: {
    // A filled accent surface is a *bright* green carrying near-black text, not a
    // dark green carrying white. That inversion is what makes one control per
    // screen read as the action without tinting the whole interface.
    fg: palette.green[400],
    surface: palette.green[400],
    onSurface: palette.neutral[975],
    subtle: withAlpha(palette.green[400], 0.13),
    border: withAlpha(palette.green[400], 0.32),
  },
  ai: {
    fg: palette.violet[400],
    surface: palette.violet[700],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.violet[500], 0.14),
    border: withAlpha(palette.violet[400], 0.3),
  },
  success: {
    fg: palette.emerald[400],
    surface: palette.emerald[700],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.emerald[500], 0.13),
    border: withAlpha(palette.emerald[400], 0.28),
  },
  warning: {
    fg: palette.amber[400],
    surface: palette.amber[700],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.amber[500], 0.13),
    border: withAlpha(palette.amber[400], 0.28),
  },
  danger: {
    fg: palette.red[400],
    surface: palette.red[700],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.red[500], 0.13),
    border: withAlpha(palette.red[400], 0.28),
  },
  info: {
    fg: palette.blue[400],
    surface: palette.blue[700],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.blue[500], 0.13),
    border: withAlpha(palette.blue[400], 0.28),
  },
  neutral: {
    fg: '#9BA5B7',
    surface: palette.neutral[800],
    onSurface: '#F2F5F9',
    subtle: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.12)',
  },

  skeleton: 'rgba(255, 255, 255, 0.055)',
  skeletonHighlight: 'rgba(255, 255, 255, 0.11)',
  track: 'rgba(255, 255, 255, 0.08)',
};

// ---------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------

export const lightColors: ThemeColors = {
  canvas: '#F6F7FA',
  surface: palette.neutral[0],
  surfaceRaised: palette.neutral[0],
  surfaceOverlay: palette.neutral[0],
  surfaceInset: '#F1F3F7',
  surfaceGlass: 'rgba(255, 255, 255, 0.72)',
  surfaceGlassStrong: 'rgba(255, 255, 255, 0.88)',
  surfaceHover: 'rgba(13, 16, 21, 0.035)',
  surfacePressed: 'rgba(13, 16, 21, 0.07)',
  scrim: 'rgba(13, 16, 21, 0.44)',

  border: 'rgba(13, 16, 21, 0.10)',
  borderSubtle: 'rgba(13, 16, 21, 0.06)',
  borderStrong: 'rgba(13, 16, 21, 0.18)',
  borderFocus: palette.green[600],
  sheen: 'rgba(255, 255, 255, 0.7)',

  text: '#0D1015',
  textSecondary: '#4A5361',
  textTertiary: '#6E7787',
  textDisabled: '#A2AAB8',
  textInverse: palette.neutral[0],

  accent: {
    // `fg` steps two stops darker than the dark theme's: the vivid 400 is
    // unreadable as text on white, and a brand colour that fails contrast is not
    // a brand colour. The filled surface keeps the dark-on-green inversion.
    fg: palette.green[700],
    surface: palette.green[600],
    onSurface: palette.green[950],
    subtle: withAlpha(palette.green[500], 0.12),
    border: withAlpha(palette.green[600], 0.28),
  },
  ai: {
    fg: palette.violet[700],
    surface: palette.violet[600],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.violet[500], 0.1),
    border: withAlpha(palette.violet[600], 0.26),
  },
  success: {
    fg: palette.emerald[700],
    surface: palette.emerald[600],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.emerald[500], 0.12),
    border: withAlpha(palette.emerald[600], 0.26),
  },
  warning: {
    fg: palette.amber[700],
    surface: palette.amber[500],
    onSurface: '#3A1F02',
    subtle: withAlpha(palette.amber[500], 0.16),
    border: withAlpha(palette.amber[600], 0.3),
  },
  danger: {
    fg: palette.red[700],
    surface: palette.red[600],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.red[500], 0.11),
    border: withAlpha(palette.red[600], 0.26),
  },
  info: {
    fg: palette.blue[700],
    surface: palette.blue[600],
    onSurface: palette.neutral[0],
    subtle: withAlpha(palette.blue[500], 0.11),
    border: withAlpha(palette.blue[600], 0.26),
  },
  neutral: {
    fg: '#4A5361',
    surface: palette.neutral[200],
    onSurface: '#0D1015',
    subtle: 'rgba(13, 16, 21, 0.05)',
    border: 'rgba(13, 16, 21, 0.12)',
  },

  skeleton: 'rgba(13, 16, 21, 0.06)',
  skeletonHighlight: 'rgba(13, 16, 21, 0.11)',
  track: 'rgba(13, 16, 21, 0.08)',
};

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

export interface ThemeGradients {
  /** Brand wash — signal green into cyan. */
  readonly brand: readonly [string, string];
  /** AI wash — violet into cyan. Signals machine reasoning. */
  readonly ai: readonly [string, string];
  /** Top-edge sheen applied to glass cards. */
  readonly sheen: readonly [string, string];
  /** Ambient glow behind hero numbers and gauges. */
  readonly glow: readonly [string, string];
  /** Health gauge ramp: critical → at-risk → healthy. */
  readonly health: readonly [string, string, string];
}

export const darkGradients: ThemeGradients = {
  brand: [palette.green[400], palette.cyan[400]],
  ai: [palette.violet[500], palette.cyan[400]],
  sheen: ['rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0)'],
  glow: [withAlpha(palette.green[400], 0.26), withAlpha(palette.green[400], 0)],
  health: [palette.red[400], palette.amber[400], palette.emerald[400]],
};

export const lightGradients: ThemeGradients = {
  brand: [palette.green[600], palette.cyan[600]],
  ai: [palette.violet[600], palette.cyan[600]],
  sheen: ['rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0)'],
  glow: [withAlpha(palette.green[500], 0.16), withAlpha(palette.green[500], 0)],
  health: [palette.red[600], palette.amber[500], palette.emerald[600]],
};
