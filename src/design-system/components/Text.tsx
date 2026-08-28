/**
 * Trackit X — Text.
 *
 * The only text primitive in the product. Screens pick a semantic `variant`
 * ("h2", "metric", "caption") and a `tone`; they never set fontSize or a raw
 * colour. That is what keeps the type hierarchy intact as the app grows, and it
 * is why data-visualisation labels can be guaranteed to wear ink tokens rather
 * than series colours.
 */
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { fontWeight, type TypographyVariant } from '../tokens';
import type { Theme } from '../theme/theme';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'disabled'
  | 'inverse'
  | 'accent'
  | 'ai'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  /**
   * Overrides the variant's weight. Use sparingly — and not on a display,
   * heading or lead variant: those carry Sora, whose weight lives in the family
   * name, so a second `fontWeight` instruction makes the browser synthesise a
   * fake bold on top of the real face. Pick the variant that already has the
   * weight you want instead.
   */
  weight?: keyof typeof fontWeight;
  /**
   * Explicit colour. Reserved for cases where the colour carries data meaning
   * that no tone covers — never for decoration.
   */
  color?: string;
  /** Renders the variant's uppercase treatment without changing the variant. */
  uppercase?: boolean;
}

export function toneColor(theme: Theme, tone: TextTone): string {
  const { colors } = theme;
  switch (tone) {
    case 'primary':
      return colors.text;
    case 'secondary':
      return colors.textSecondary;
    case 'tertiary':
      return colors.textTertiary;
    case 'disabled':
      return colors.textDisabled;
    case 'inverse':
      return colors.textInverse;
    case 'accent':
      return colors.accent.fg;
    case 'ai':
      return colors.ai.fg;
    case 'success':
      return colors.success.fg;
    case 'warning':
      return colors.warning.fg;
    case 'danger':
      return colors.danger.fg;
    case 'info':
      return colors.info.fg;
  }
}

export function Text({
  variant = 'body',
  tone = 'primary',
  align,
  weight,
  color,
  uppercase,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();

  return (
    <RNText
      {...rest}
      style={[
        theme.typography[variant],
        { color: color ?? toneColor(theme, tone) },
        align !== undefined && { textAlign: align },
        weight !== undefined && { fontWeight: fontWeight[weight] },
        uppercase === true && { textTransform: 'uppercase' as const },
        style,
      ]}
    />
  );
}
