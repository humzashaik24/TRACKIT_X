/**
 * Trackit X — Card.
 *
 * The container everything sits in. Four variants cover the whole product:
 *
 *   solid     the default panel
 *   raised    a panel above another panel (nested lists, drill-downs)
 *   glass     floating chrome and feature surfaces
 *   outline   a container that groups without adding visual weight
 *
 * A card with `onPress` becomes a real button — it gains press feedback, a
 * pressed wash, and an accessibility role — rather than a `View` wrapped in a
 * touchable, which is how card grids usually end up unnavigable.
 *
 * The hover/press wash is an overlay, not a background swap: the tokens are
 * translucent, so assigning one as `backgroundColor` would make the card
 * see-through instead of highlighted.
 */
import { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { usePressAnimation } from '../hooks/usePressAnimation';
import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { radius, space, type ElevationToken, type RadiusToken, type SpaceToken } from '../tokens';
import { GlassSurface } from './GlassSurface';

export type CardVariant = 'solid' | 'raised' | 'glass' | 'outline';
export type CardIntent = 'neutral' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'info';

export interface CardProps extends Omit<ViewProps, 'style'> {
  variant?: CardVariant;
  /** Tints the border and, with `accentEdge`, the leading edge. */
  intent?: CardIntent;
  /** Interior padding. Defaults to the density-appropriate card padding. */
  padding?: SpaceToken | 'none';
  corner?: RadiusToken;
  elevation?: ElevationToken;
  /** Makes the card a button. */
  onPress?: PressableProps['onPress'];
  disabled?: boolean;
  style?: ViewStyle | (ViewStyle | false | undefined)[];
  /** Draws a 3px coloured edge on the leading side — for status-bearing rows. */
  accentEdge?: boolean;
}

export function Card({
  variant = 'solid',
  intent = 'neutral',
  padding,
  corner = 'lg',
  elevation,
  onPress,
  disabled = false,
  style,
  accentEdge = false,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const { cardPadding } = useResponsive();
  const interactive = onPress !== undefined && !disabled;
  const press = usePressAnimation({ enabled: interactive });
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);

  const intentColors = theme.colors[intent];
  const resolvedPadding =
    padding === 'none' ? 0 : padding === undefined ? cardPadding : space[padding];
  const resolvedElevation =
    elevation ?? (variant === 'raised' ? 'md' : variant === 'solid' ? 'sm' : 'none');

  const base: ViewStyle = {
    borderRadius: radius[corner],
    padding: resolvedPadding,
    ...(accentEdge && {
      borderLeftWidth: 3,
      borderLeftColor: intent === 'neutral' ? theme.colors.borderStrong : intentColors.fg,
    }),
    ...(disabled && { opacity: 0.55 }),
  };

  const surfaceStyle: ViewStyle =
    variant === 'outline'
      ? {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: intent === 'neutral' ? theme.colors.border : intentColors.border,
        }
      : {
          backgroundColor: variant === 'raised' ? theme.colors.surfaceRaised : theme.colors.surface,
          borderWidth: 1,
          borderColor: intent === 'neutral' ? theme.colors.border : intentColors.border,
          ...theme.shadows[resolvedElevation],
        };

  const extra = Array.isArray(style) ? style : style ? [style] : [];

  /** Translucent hover/press wash, drawn over the surface. */
  const wash = (pressed: boolean) =>
    (pressed || hovered) && (
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius[corner],
            backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceHover,
          },
        ]}
      />
    );

  if (variant === 'glass') {
    if (!interactive) {
      return (
        <GlassSurface {...rest} corner={corner} style={[base, ...extra]}>
          {children}
        </GlassSurface>
      );
    }
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
        accessibilityRole="button"
        {...rest}
      >
        {({ pressed }) => (
          <Animated.View style={press.animatedStyle}>
            <GlassSurface corner={corner} style={[base, ...extra]}>
              {wash(pressed)}
              {children}
            </GlassSurface>
          </Animated.View>
        )}
      </Pressable>
    );
  }

  if (!interactive) {
    return (
      <View {...rest} style={[base, surfaceStyle, ...extra]}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
      {...rest}
    >
      {({ pressed }) => (
        <Animated.View style={[base, surfaceStyle, press.animatedStyle, ...extra]}>
          {wash(pressed)}
          {children}
        </Animated.View>
      )}
    </Pressable>
  );
}
