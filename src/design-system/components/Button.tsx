/**
 * Trackit X — Button.
 *
 * Five hierarchy levels, one shape. `primary` is the single action a screen
 * wants you to take; `secondary` is a real alternative; `ghost` and `link` are
 * for actions that must not compete with the content. `danger` is reserved for
 * destructive intent and is never used to mean "important".
 *
 * A loading button keeps its width and stays labelled for screen readers, so the
 * layout does not jump and the action does not become anonymous mid-flight.
 */
import { LinearGradient } from 'expo-linear-gradient';
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
import { controlHeight, layout, radius, space, type ControlSize } from '../tokens';
import { Icon, type IconName } from './Icon';
import { Text, type TextTone } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'danger';
export type ButtonIntent = 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'info';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  /** Recolours filled/outline variants. `danger` variant pins this to danger. */
  intent?: ButtonIntent;
  size?: ControlSize;
  iconLeft?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  /** Brand gradient fill — for the one hero action on a landing surface. */
  gradient?: boolean;
  style?: ViewStyle;
}

/** Horizontal padding and type scale per control size. */
const sizing = {
  xs: { paddingX: space[2.5], variant: 'labelSm', icon: 'xs' },
  sm: { paddingX: space[3], variant: 'labelSm', icon: 'sm' },
  md: { paddingX: space[4], variant: 'label', icon: 'md' },
  lg: { paddingX: space[5], variant: 'label', icon: 'lg' },
  xl: { paddingX: space[6], variant: 'bodyLg', icon: 'lg' },
} as const;

export function Button({
  label,
  variant = 'primary',
  intent = 'accent',
  size = 'md',
  iconLeft,
  iconRight,
  loading = false,
  fullWidth = false,
  gradient = false,
  disabled = false,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const resolvedIntent: ButtonIntent = variant === 'danger' ? 'danger' : intent;
  const colors = theme.colors[resolvedIntent];
  const isDisabled = disabled || loading;
  const press = usePressAnimation({ enabled: !isDisabled });
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);

  const spec = sizing[size];
  const filled = variant === 'primary' || variant === 'danger';
  const isBare = variant === 'ghost' || variant === 'link';
  /** Small controls keep a 44px *touchable* area even though they draw smaller. */
  const touchPad = Math.max(0, (layout.minTouchTarget - controlHeight[size]) / 2);

  const contentTone: TextTone | undefined = filled
    ? undefined
    : variant === 'secondary'
      ? 'primary'
      : resolvedIntent === 'accent'
        ? 'accent'
        : resolvedIntent;
  const contentColor = filled ? colors.onSurface : undefined;

  const container: ViewStyle = {
    height: variant === 'link' ? undefined : controlHeight[size],
    paddingHorizontal: variant === 'link' ? 0 : spec.paddingX,
    borderRadius: variant === 'link' ? radius.xs : radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    ...(fullWidth && { width: '100%' }),
    ...(isDisabled && { opacity: 0.5 }),
  };

  const skin: ViewStyle = filled
    ? { backgroundColor: gradient ? 'transparent' : colors.surface, ...theme.shadows.xs }
    : variant === 'secondary'
      ? { backgroundColor: theme.colors.neutral.subtle, borderWidth: 1, borderColor: theme.colors.border }
      : variant === 'outline'
        ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }
        : { backgroundColor: 'transparent' };

  const content = (
    <>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={contentColor ?? colors.fg}
          accessibilityLabel={`${label} in progress`}
        />
      ) : (
        iconLeft !== undefined && (
          <Icon name={iconLeft} size={spec.icon} tone={contentTone} color={contentColor} />
        )
      )}
      <Text
        variant={spec.variant}
        tone={contentTone}
        color={contentColor}
        numberOfLines={1}
        style={variant === 'link' ? styles.linkLabel : undefined}
      >
        {label}
      </Text>
      {!loading && iconRight !== undefined && (
        <Icon name={iconRight} size={spec.icon} tone={contentTone} color={contentColor} />
      )}
    </>
  );

  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={isDisabled}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={touchPad}
      style={fullWidth ? styles.fullWidth : undefined}
    >
      {({ pressed }) => (
        <Animated.View style={[container, skin, press.animatedStyle, style]}>
          {gradient && filled && (
            <LinearGradient
              colors={resolvedIntent === 'ai' ? theme.gradients.ai : theme.gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: radius.md }]}
            />
          )}
          {(pressed || hovered) && !isDisabled && (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: variant === 'link' ? radius.xs : radius.md,
                  backgroundColor: filled
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
          {isBare && variant === 'link' ? <View style={styles.linkRow}>{content}</View> : content}
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fullWidth: { width: '100%' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  linkLabel: { textDecorationLine: 'underline' },
});
