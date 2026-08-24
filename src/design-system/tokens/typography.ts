/**
 * Trackit X — typography tokens.
 *
 * One scale, used everywhere. Variants are semantic ("metric", "label") rather
 * than presentational ("text-lg") so the hierarchy survives redesigns.
 *
 * Numeric data uses `tabular-nums` so digits do not jitter when values update
 * in realtime — important for a dashboard that ticks.
 */
import { Platform, type TextStyle } from 'react-native';

export const fontFamily = {
  sans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default:
      '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  }) as string,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

/**
 * The complete set of text roles in the product. Adding a role is a design
 * decision; ad-hoc font sizes in components are a lint-level smell.
 */
export type TypographyVariant =
  | 'displayLg'
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'bodyLg'
  | 'body'
  | 'bodySm'
  | 'label'
  | 'labelSm'
  | 'overline'
  | 'caption'
  | 'metricLg'
  | 'metric'
  | 'metricSm'
  | 'mono';

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const typography: Record<TypographyVariant, TextStyle> = {
  /** Marketing-scale hero number or title. Used sparingly. */
  displayLg: {
    fontFamily: fontFamily.sans,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: fontWeight.bold,
    letterSpacing: -1.1,
  },
  display: {
    fontFamily: fontFamily.sans,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.7,
  },
  /** Screen title. */
  h1: {
    fontFamily: fontFamily.sans,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  /** Section title. */
  h2: {
    fontFamily: fontFamily.sans,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.3,
  },
  /** Card title. */
  h3: {
    fontFamily: fontFamily.sans,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
  /** Row / list-item title. */
  h4: {
    fontFamily: fontFamily.sans,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  bodyLg: { fontFamily: fontFamily.sans, fontSize: 16, lineHeight: 24, fontWeight: fontWeight.regular },
  body: { fontFamily: fontFamily.sans, fontSize: 14.5, lineHeight: 21, fontWeight: fontWeight.regular },
  bodySm: { fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19, fontWeight: fontWeight.regular },
  /** Form labels, button text, tab text. */
  label: {
    fontFamily: fontFamily.sans,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.1,
  },
  labelSm: {
    fontFamily: fontFamily.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.15,
  },
  /** Small-caps section eyebrow. Pair with `textTransform: 'uppercase'`. */
  overline: {
    fontFamily: fontFamily.sans,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  caption: {
    fontFamily: fontFamily.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeight.regular,
  },
  /** Hero KPI value. */
  metricLg: {
    fontFamily: fontFamily.sans,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: fontWeight.bold,
    letterSpacing: -1.6,
    ...tabular,
  },
  metric: {
    fontFamily: fontFamily.sans,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.8,
    ...tabular,
  },
  metricSm: {
    fontFamily: fontFamily.sans,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.3,
    ...tabular,
  },
  /** Identifiers, SKUs, correlation ids, JSON. */
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: fontWeight.regular,
  },
};
