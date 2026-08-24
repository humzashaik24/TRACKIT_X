/**
 * Trackit X — ProgressBar.
 *
 * Determinate by default. The indeterminate mode is for work with genuinely
 * unknown duration; a fake progress animation over a known-length task is a lie
 * about state, so it is not offered.
 *
 * The value is always available as text to assistive technology even when the
 * label is not drawn, because a bare bar communicates nothing without sight.
 */
import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useTheme } from '../hooks/useTheme';
import { motion, radius, space } from '../tokens';
import { HStack } from './Stack';
import { Text } from './Text';

export type ProgressIntent = 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'info';

export interface ProgressBarProps {
  /** 0–1. Values outside the range are clamped. Ignored when indeterminate. */
  value?: number;
  intent?: ProgressIntent;
  /** Track thickness in px. */
  thickness?: number;
  indeterminate?: boolean;
  /** Draws the percentage beside the bar. */
  showValue?: boolean;
  /** Describes what is progressing, for assistive technology. */
  label?: string;
  style?: ViewStyle;
}

export function ProgressBar({
  value = 0,
  intent = 'accent',
  thickness = 6,
  indeterminate = false,
  showValue = false,
  label,
  style,
}: ProgressBarProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const colors = theme.colors[intent];

  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);

  const progress = useSharedValue(clamped);
  const sweep = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? clamped
      : withTiming(clamped, {
          duration: motion.duration.slow,
          easing: Easing.bezier(...motion.curve.standard),
        });
  }, [clamped, progress, reduceMotion]);

  useEffect(() => {
    if (!indeterminate || reduceMotion) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    sweep.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: motion.duration.ambient,
          easing: Easing.bezier(...motion.curve.standard),
        }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(sweep);
    };
  }, [indeterminate, reduceMotion, sweep]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    left: `${sweep.value * 100 - 35}%`,
  }));

  const bar = (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        indeterminate ? { text: 'In progress' } : { min: 0, max: 100, now: percent }
      }
      style={[
        {
          flex: 1,
          height: thickness,
          borderRadius: radius.pill,
          backgroundColor: theme.colors.track,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {indeterminate ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: '35%',
              borderRadius: radius.pill,
              backgroundColor: colors.fg,
            },
            reduceMotion ? { left: '0%' } : sweepStyle,
          ]}
        />
      ) : (
        <Animated.View
          style={[
            { height: '100%', borderRadius: radius.pill, backgroundColor: colors.fg },
            fillStyle,
          ]}
        />
      )}
    </View>
  );

  if (!showValue) return bar;

  return (
    <HStack gap={3}>
      {bar}
      <Text variant="metricSm" tone="secondary" style={{ minWidth: space[10], textAlign: 'right' }}>
        {indeterminate ? '—' : `${percent}%`}
      </Text>
    </HStack>
  );
}
