/**
 * Trackit X — Divider.
 *
 * A hairline, never a heavy rule. Dividers are the cheapest way to group
 * content; whitespace is usually cheaper still, so reach for this second.
 */
import { View, type ViewProps } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { space, type SpaceToken } from '../tokens';

export interface DividerProps extends ViewProps {
  orientation?: 'horizontal' | 'vertical';
  /** Faintest line — for dividing rows inside one card. */
  subtle?: boolean;
  /** Margin along the divider's cross axis. */
  spacing?: SpaceToken;
  /** Insets both ends, e.g. to align with a list's text column. */
  inset?: number;
}

export function Divider({
  orientation = 'horizontal',
  subtle = false,
  spacing,
  inset,
  style,
  ...rest
}: DividerProps) {
  const { colors } = useTheme();
  const color = subtle ? colors.borderSubtle : colors.border;
  const margin = spacing === undefined ? undefined : space[spacing];

  return (
    <View
      {...rest}
      accessibilityRole="none"
      style={[
        orientation === 'horizontal'
          ? {
              height: 1,
              alignSelf: 'stretch',
              backgroundColor: color,
              ...(margin !== undefined && { marginVertical: margin }),
              ...(inset !== undefined && { marginHorizontal: inset }),
            }
          : {
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: color,
              ...(margin !== undefined && { marginHorizontal: margin }),
              ...(inset !== undefined && { marginVertical: inset }),
            },
        style,
      ]}
    />
  );
}
