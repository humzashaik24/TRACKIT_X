/**
 * Trackit X — entrance reveal.
 *
 * One implementation of "this arrived on screen", so a staged reveal is a list of
 * delays rather than a hand-rolled animation per component. Used by the marketing
 * surfaces, where the sequence itself carries the hierarchy: background, headline,
 * supporting statement, description, actions, trust line.
 *
 * ── Reduce-motion is a jump, not a shorter animation ────────────────────────
 * When the setting is on the value is assigned outright. Shortening the duration
 * would still move the element, which is the thing the setting exists to prevent.
 *
 * ── The one thing to be careful about ──────────────────────────────────────
 * The element starts at opacity 0, so if the effect never ran the content would be
 * invisible rather than merely unanimated. That is safe here because the app is a
 * client-rendered single-page build (`web.output: "single"`), so mount and effect
 * always happen together — but it is the reason this hook must not be used inside
 * a server-rendered tree without revisiting the initial value.
 */
import { useEffect } from 'react';
import type { ViewStyle } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

import { motion } from '../tokens';
import { useReducedMotion } from './useReducedMotion';

export interface EntranceOptions {
  /** Position in the reveal sequence, in milliseconds. */
  delay?: number;
  /** How far the element travels up into place. 0 fades only. */
  distance?: number;
  /** Starting scale. 1 disables the scale component. */
  scaleFrom?: number;
  duration?: number;
}

export function useEntrance({
  delay = 0,
  distance = 18,
  scaleFrom = 1,
  duration = 700,
}: EntranceOptions = {}): AnimatedStyle<ViewStyle> {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.value = reduceMotion
      ? 1
      : withDelay(
          delay,
          withTiming(1, { duration, easing: Easing.bezier(...motion.curve.entrance) }),
        );
  }, [delay, duration, progress, reduceMotion]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * distance },
      { scale: scaleFrom + (1 - scaleFrom) * progress.value },
    ],
  }));
}
