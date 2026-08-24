/**
 * Trackit X — IconButton.
 *
 * An icon-only control. `accessibilityLabel` is required rather than optional:
 * an unlabelled icon button is invisible to a screen reader, and making the prop
 * mandatory is the only reliable way to prevent that.
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { usePressAnimation } from '../hooks/usePressAnimation';
import { useTheme } from '../hooks/useTheme';
import { controlHeight, layout, radius, type ControlSize } from '../tokens';
import { Icon, type IconName } from './Icon';
import type { TextTone } from './Text';

export type IconButtonVariant = 'solid' | 'soft' | 'outline' | 'ghost';
export type IconButtonIntent = 'neutral' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'info';

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: IconName;
  /** Required — an unlabelled icon button is unusable with a screen reader. */
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  intent?: IconButtonIntent;
  size?: ControlSize;
  loading?: boolean;
  /** Renders as a circle instead of a rounded square. */
  round?: boolean;
  style?: ViewStyle;
}

const iconForSize = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
} as const;

export function IconButton({
  icon,
  accessibilityLabel,
  variant = 'ghost',
  intent = 'neutral',
  size = 'md',
  loading = false,
  round = false,
  disabled = false,
  style,
  ...rest
}: IconButtonProps) {
  const theme = useTheme();
  const colors = theme.colors[intent];
  const isDisabled = disabled || loading;
  const press = usePressAnimation({ enabled: !isDisabled });
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);

  const dimension = controlHeight[size];
  const corner = round ? radius.pill : radius.md;
  const touchPad = Math.max(0, (layout.minTouchTarget - dimension) / 2);

  const tone: TextTone = intent === 'neutral' ? 'secondary' : intent === 'accent' ? 'accent' : intent;
  const contentColor = variant === 'solid' ? colors.onSurface : undefined;

  const skin: ViewStyle =
    variant === 'solid'
      ? { backgroundColor: colors.surface }
      : variant === 'soft'
        ? { backgroundColor: colors.subtle, borderWidth: 1, borderColor: colors.border }
        : variant === 'outline'
          ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.border }
          : { backgroundColor: 'transparent' };

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={touchPad}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            {
              width: dimension,
              height: dimension,
              borderRadius: corner,
              alignItems: 'center',
              justifyContent: 'center',
              ...(isDisabled && { opacity: 0.45 }),
            },
            skin,
            press.animatedStyle,
            style,
          ]}
        >
          {(pressed || hovered) && !isDisabled && (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: corner,
                  backgroundColor:
                    variant === 'solid'
                      ? pressed
                        ? 'rgba(0, 0, 0, 0.18)'
                        : 'rgba(255, 255, 255, 0.10)'
                      : pressed
                        ? theme.colors.surfacePressed
                        : theme.colors.surfaceHover,
                },
              ]}
            />
          )}
          {loading ? (
            <ActivityIndicator size="small" color={contentColor ?? colors.fg} />
          ) : (
            <Icon
              name={icon}
              size={iconForSize[size]}
              tone={tone}
              color={contentColor}
            />
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}
