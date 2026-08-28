/**
 * Trackit X — typography tokens.
 *
 * One scale, used everywhere. Variants are semantic ("metric", "label") rather
 * than presentational ("text-lg") so the hierarchy survives redesigns.
 *
 * ── Two families, on purpose ────────────────────────────────────────────────
 * Sora carries the brand: display sizes, headings, eyebrows and the long lead
 * paragraphs on marketing surfaces. Business data — body copy, labels, metrics,
 * identifiers — stays on the platform sans, which is hinted for small sizes on
 * the machine it is being read on and has the tabular figures a ticking
 * dashboard needs. A geometric display face and a neutral UI face is a pairing,
 * not an inconsistency.
 *
 * Numeric data uses `tabular-nums` so digits do not jitter when values update
 * in realtime — important for a dashboard that ticks.
 */
import { Platform, type TextStyle } from 'react-native';

const systemSans =
  '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Sora, one family name per weight.
 *
 * That shape is dictated by `expo-font`, which is the correct loader for an Expo
 * app and the reason there is no `<link>` to a font CDN anywhere in this project.
 * Its web implementation writes `@font-face{font-family:"Sora_700Bold";src:…}`
 * with no `font-weight` descriptor, and its native implementation registers each
 * file under the key it was loaded with. So the weight lives in the family name.
 *
 * The consequence, which the variants below respect: a brand variant must NOT
 * also set `fontWeight`. Asking CSS for 700 from a family whose only face is
 * registered at the default weight makes the browser synthesise a second, smeared
 * bold on top of the real one.
 *
 * `app/_layout.tsx` loads exactly these five names. Adding a weight here without
 * registering it there yields a silent fallback to the system sans.
 */
export const brandFont = {
  light: 'Sora_300Light',
  regular: 'Sora_400Regular',
  medium: 'Sora_500Medium',
  semibold: 'Sora_600SemiBold',
  bold: 'Sora_700Bold',
} as const;

export type BrandFontWeight = keyof typeof brandFont;

/**
 * The brand family for `weight`, with a fallback stack on web.
 *
 * React Native Web passes `fontFamily` through to CSS verbatim, so a comma list
 * degrades to the platform sans if the webfont has not arrived yet. Native takes
 * a single family name — a comma list there resolves to nothing.
 */
function brand(weight: BrandFontWeight): string {
  return Platform.select({
    ios: brandFont[weight],
    android: brandFont[weight],
    default: `"${brandFont[weight]}", ${systemSans}`,
  }) as string;
}

export const fontFamily = {
  sans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: systemSans,
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  }) as string,
  /** Sora at each registered weight — display type, headings, marketing lead copy. */
  brand: {
    light: brand('light'),
    regular: brand('regular'),
    medium: brand('medium'),
    semibold: brand('semibold'),
    bold: brand('bold'),
  },
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
  | 'heroLg'
  | 'hero'
  | 'heroSm'
  | 'displayLg'
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'lead'
  | 'leadSm'
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
  /**
   * Cinematic hero headline, desktop. Three fixed sizes rather than one scaled
   * value: a headline this large needs its own line-height and tracking at each
   * step, and interpolating them produces type that is either too airy or too
   * tight at the ends of the range.
   */
  heroLg: {
    fontFamily: fontFamily.brand.bold,
    fontSize: 74,
    lineHeight: 78,
    letterSpacing: -2.9,
  },
  /** Hero headline, tablet. */
  hero: {
    fontFamily: fontFamily.brand.bold,
    fontSize: 52,
    lineHeight: 57,
    letterSpacing: -1.8,
  },
  /** Hero headline, phone. */
  heroSm: {
    fontFamily: fontFamily.brand.bold,
    fontSize: 36,
    lineHeight: 41,
    letterSpacing: -1.1,
  },
  /** Marketing-scale hero number or section title. Used sparingly. */
  displayLg: {
    fontFamily: fontFamily.brand.bold,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.1,
  },
  display: {
    fontFamily: fontFamily.brand.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.7,
  },
  /** Screen title. */
  h1: {
    fontFamily: fontFamily.brand.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  /** Section title. */
  h2: {
    fontFamily: fontFamily.brand.semibold,
    fontSize: 21,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  /** Card title. */
  h3: {
    fontFamily: fontFamily.brand.semibold,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  /** Row / list-item title. */
  h4: {
    fontFamily: fontFamily.brand.semibold,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  /** Long supporting paragraph under a hero or section title. Light and open. */
  lead: {
    fontFamily: fontFamily.brand.light,
    fontSize: 19,
    lineHeight: 30,
    letterSpacing: -0.1,
  },
  leadSm: {
    fontFamily: fontFamily.brand.light,
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.05,
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
    fontFamily: fontFamily.brand.semibold,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.1,
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
