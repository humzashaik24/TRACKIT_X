/**
 * Trackit X — Skeleton.
 *
 * Loading placeholders that match the *shape* of the content that will replace
 * them, so the layout does not reflow on arrival. A shimmer that never resolves
 * is worse than a spinner, so screens must pair skeletons with a real timeout
 * path to `ErrorState`.
 */
import { useEffect } from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useTheme } from '../hooks/useTheme';
import { motion, radius, space, type RadiusToken } from '../tokens';
import { VStack } from './Stack';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  corner?: RadiusToken;
  /** Renders a circle of `height` diameter — for avatar placeholders. */
  circle?: boolean;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 14,
  corner = 'xs',
  circle = false,
  style,
}: SkeletonProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 0.5;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, {
        duration: motion.duration.ambient,
        easing: Easing.bezier(...motion.curve.standard),
      }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.value * 0.45,
  }));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: circle ? height : width,
          height,
          borderRadius: circle ? radius.pill : radius[corner],
          backgroundColor: theme.colors.skeleton,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** A block of text lines, with a shorter final line as real paragraphs have. */
export function SkeletonText({ lines = 3, lastLineWidth = '62%' }: { lines?: number; lastLineWidth?: DimensionValue }) {
  return (
    <VStack gap={2}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} height={12} width={index === lines - 1 ? lastLineWidth : '100%'} />
      ))}
    </VStack>
  );
}

/** Card-shaped placeholder: title, two body lines, a metric. */
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      style={[
        {
          padding: space[5],
          gap: space[3],
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.surface,
        },
        style,
      ]}
    >
      <Skeleton width="45%" height={11} />
      <Skeleton width="70%" height={26} corner="sm" />
      <Skeleton width="30%" height={11} />
    </View>
  );
}
