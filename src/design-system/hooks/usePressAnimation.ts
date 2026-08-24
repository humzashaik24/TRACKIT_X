/**
 * Trackit X — press feedback.
 *
 * One implementation of "this thing responds to touch", shared by every
 * pressable in the design system so feedback is identical everywhere. Honours
 * reduce-motion by dropping straight to the target value instead of shortening
 * the animation.
 */
import { useCallback } from 'react';
import type { ViewStyle } from 'react-native';
import {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

import { motion } from '../tokens';
import { useReducedMotion } from './useReducedMotion';

export interface PressAnimation {
  animatedStyle: AnimatedStyle<ViewStyle>;
  onPressIn(): void;
  onPressOut(): void;
}

export interface PressAnimationOptions {
  /** Scale at rest is 1; this is the pressed scale. */
  scale?: number;
  /** Opacity while pressed. 1 leaves opacity alone. */
  opacity?: number;
  enabled?: boolean;
}

export function usePressAnimation({
  scale = motion.pressScale,
  opacity = 1,
  enabled = true,
}: PressAnimationOptions = {}): PressAnimation {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  const animate = useCallback(
    (to: number) => {
      if (!enabled) return;
      progress.value = reduceMotion
        ? withTiming(to, { duration: motion.duration.instant })
        : withSpring(to, motion.spring.snappy);
    },
    [enabled, progress, reduceMotion],
  );

  const onPressIn = useCallback(() => animate(1), [animate]);
  const onPressOut = useCallback(() => animate(0), [animate]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (scale - 1) * progress.value }],
    opacity: 1 + (opacity - 1) * progress.value,
  }));

  return { animatedStyle, onPressIn, onPressOut };
}
