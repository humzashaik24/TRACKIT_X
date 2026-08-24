/**
 * Trackit X — Badge.
 *
 * Compact state and count labels. Status badges always carry a label, and
 * `withIcon` adds the matching glyph, because colour alone is not a signal —
 * that rule is why a red badge and a red chart series can coexist without
 * ambiguity.
 */
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { radius, space } from '../tokens';
import { Icon, type IconName } from './Icon';
import { Text, type TextTone } from './Text';

export type BadgeIntent = 'neutral' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeVariant = 'soft' | 'solid' | 'outline' | 'dot';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  label: string;
  intent?: BadgeIntent;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Explicit icon. Ignored by the `dot` variant, which draws its own marker. */
  icon?: IconName;
  /** Adds the conventional glyph for the intent — the colour-blind-safe default. */
  withIcon?: boolean;
  style?: ViewStyle;
}

/** The glyph each status intent conventionally carries. */
const intentIcon: Record<BadgeIntent, IconName | undefined> = {
  neutral: undefined,
  accent: undefined,
  ai: 'aiSpark',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

export function Badge({
  label,
  intent = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  withIcon = false,
  style,
}: BadgeProps) {
  const theme = useTheme();
  const colors = theme.colors[intent];
  const glyph = icon ?? (withIcon ? intentIcon[intent] : undefined);

  const tone: TextTone =
    variant === 'solid'
      ? 'primary'
      : intent === 'neutral'
        ? 'secondary'
        : intent === 'accent'
          ? 'accent'
          : intent;

  const skin: ViewStyle =
    variant === 'solid'
      ? { backgroundColor: colors.surface }
      : variant === 'outline'
        ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }
        : variant === 'dot'
          ? { backgroundColor: 'transparent' }
          : { backgroundColor: colors.subtle, borderWidth: 1, borderColor: colors.border };

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: space[1.5],
          borderRadius: radius.pill,
          paddingHorizontal: variant === 'dot' ? 0 : size === 'sm' ? space[2] : space[2.5],
          paddingVertical: variant === 'dot' ? 0 : size === 'sm' ? space[0.5] : space[1],
        },
        skin,
        style,
      ]}
    >
      {variant === 'dot' && (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: radius.pill,
            backgroundColor: intent === 'neutral' ? theme.colors.textTertiary : colors.fg,
          }}
        />
      )}
      {glyph !== undefined && variant !== 'dot' && (
        <Icon
          name={glyph}
          size={size === 'sm' ? 'xs' : 'sm'}
          tone={tone}
          color={variant === 'solid' ? colors.onSurface : undefined}
        />
      )}
      <Text
        variant={size === 'sm' ? 'labelSm' : 'label'}
        tone={tone}
        color={variant === 'solid' ? colors.onSurface : undefined}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
