/**
 * Trackit X — elevation tokens.
 *
 * Shadows are expressed per platform because React Native, iOS and the web all
 * model them differently. Consumers get a plain `ViewStyle` and never branch.
 *
 * On the dark theme, elevation is carried mostly by surface lightness and
 * borders; shadows are deep and diffuse so they read as depth rather than as
 * grey smudges. On light, they behave conventionally.
 */
import { Platform, type ViewStyle } from 'react-native';

interface ShadowSpec {
  /** Vertical offset in px. */
  y: number;
  /** Blur radius in px. */
  blur: number;
  /** Spread in px — web only. */
  spread: number;
  /** Shadow opacity, 0–1. */
  opacity: number;
  /** Android elevation value. */
  elevation: number;
}

function toStyle(spec: ShadowSpec, shadowColor: string, rgb: string): ViewStyle {
  if (spec.elevation === 0) {
    return {};
  }
  return Platform.select<ViewStyle>({
    web: {
      // `boxShadow` is a web-only style key; cast keeps the shared ViewStyle contract.
      boxShadow: `0px ${spec.y}px ${spec.blur}px ${spec.spread}px rgba(${rgb}, ${spec.opacity})`,
    } as ViewStyle,
    ios: {
      shadowColor,
      shadowOffset: { width: 0, height: spec.y },
      shadowOpacity: spec.opacity,
      shadowRadius: spec.blur / 2,
    },
    default: {
      elevation: spec.elevation,
      shadowColor,
    },
  }) as ViewStyle;
}

export type ElevationToken = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ThemeShadows extends Record<ElevationToken, ViewStyle> {
  /** Signal-green glow — primary call to action, focus emphasis. */
  readonly glowAccent: ViewStyle;
  /** Violet glow — AI surfaces. */
  readonly glowAi: ViewStyle;
}

const specs: Record<Exclude<ElevationToken, 'none'>, ShadowSpec> = {
  /** Barely lifted: hovered row, small chip. */
  xs: { y: 1, blur: 2, spread: 0, opacity: 0.2, elevation: 1 },
  /** Resting card. */
  sm: { y: 2, blur: 8, spread: -2, opacity: 0.26, elevation: 2 },
  /** Raised card, dropdown. */
  md: { y: 6, blur: 20, spread: -6, opacity: 0.34, elevation: 6 },
  /** Popover, floating action bar. */
  lg: { y: 14, blur: 36, spread: -10, opacity: 0.42, elevation: 12 },
  /** Modal, bottom sheet. */
  xl: { y: 26, blur: 64, spread: -16, opacity: 0.52, elevation: 24 },
};

function build(shadowColor: string, rgb: string, opacityScale: number): ThemeShadows {
  const scaled = (spec: ShadowSpec): ShadowSpec => ({
    ...spec,
    opacity: Math.min(1, spec.opacity * opacityScale),
  });
  return {
    none: {},
    xs: toStyle(scaled(specs.xs), shadowColor, rgb),
    sm: toStyle(scaled(specs.sm), shadowColor, rgb),
    md: toStyle(scaled(specs.md), shadowColor, rgb),
    lg: toStyle(scaled(specs.lg), shadowColor, rgb),
    xl: toStyle(scaled(specs.xl), shadowColor, rgb),
    glowAccent: toStyle(
      { y: 0, blur: 28, spread: -4, opacity: 0.45, elevation: 8 },
      // `palette.green[500]` rather than either theme's `accent.fg`: one glow is
      // built for both modes here, and the 500 step is the midpoint between the
      // dark theme's bright 400 and the light theme's darker 600/700.
      '#0FD265',
      '15, 210, 101',
    ),
    glowAi: toStyle(
      { y: 0, blur: 28, spread: -4, opacity: 0.45, elevation: 8 },
      '#9061F9',
      '144, 97, 249',
    ),
  };
}

/** Deep, near-black shadows for the dark theme. */
export const darkShadows: ThemeShadows = build('#000000', '0, 0, 0', 1);

/** Softer, cooler shadows for the light theme. */
export const lightShadows: ThemeShadows = build('#0D1015', '13, 16, 21', 0.42);
