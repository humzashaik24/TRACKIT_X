/**
 * Trackit X — LoadingState.
 *
 * Two treatments, chosen by what is known about the wait:
 *
 *  · `skeleton` when the shape of the result is known — it holds the layout so
 *    nothing jumps on arrival. This is the default for lists and dashboards.
 *  · `spinner` when the shape is unknown, or the surface is too small for a
 *    skeleton to mean anything.
 *
 * A label is offered because a long wait with no explanation reads as a hang.
 * There is no fake progress bar: a determinate bar over an unknown wait is a lie
 * about state.
 */
import { ActivityIndicator, View, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { space } from '../tokens';
import { SkeletonCard, SkeletonText } from './Skeleton';
import { VStack } from './Stack';
import { Text } from './Text';

export type LoadingVariant = 'skeleton' | 'spinner' | 'cards' | 'text';

export interface LoadingStateProps {
  variant?: LoadingVariant;
  /** What is being loaded, e.g. "Loading payroll runs". */
  label?: string;
  /** Number of placeholder blocks for the skeleton variants. */
  count?: number;
  /** Fills the available space and centres the spinner. */
  fill?: boolean;
  style?: ViewStyle;
}

export function LoadingState({
  variant = 'skeleton',
  label,
  count = 3,
  fill = false,
  style,
}: LoadingStateProps) {
  const theme = useTheme();

  // One accessibility announcement for the whole block: a screen reader should
  // hear "loading", not a list of placeholder shapes.
  const a11y = {
    accessible: true,
    accessibilityRole: 'progressbar' as const,
    accessibilityLabel: label ?? 'Loading',
    accessibilityValue: { text: 'Loading' },
  };

  if (variant === 'spinner') {
    return (
      <View
        {...a11y}
        style={[
          {
            alignItems: 'center',
            justifyContent: 'center',
            gap: space[3],
            paddingVertical: space[8],
            ...(fill && { flex: 1 }),
          },
          style,
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.accent.fg} />
        {label !== undefined && (
          <Text variant="bodySm" tone="tertiary">
            {label}
          </Text>
        )}
      </View>
    );
  }

  if (variant === 'text') {
    return (
      <View {...a11y} style={[{ gap: space[3], ...(fill && { flex: 1 }) }, style]}>
        <SkeletonText lines={count} />
      </View>
    );
  }

  return (
    <View {...a11y} style={[{ gap: space[3], ...(fill && { flex: 1 }) }, style]}>
      <VStack gap={3}>
        {Array.from({ length: count }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </VStack>
    </View>
  );
}
