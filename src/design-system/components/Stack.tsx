/**
 * Trackit X — layout primitives.
 *
 * `Stack` replaces the ad-hoc `View` with margins that every codebase
 * accumulates. Gaps come from the spacing scale, so vertical rhythm is a token
 * decision rather than a per-screen guess.
 */
import { View, type ViewProps, type ViewStyle } from 'react-native';

import { space, type SpaceToken } from '../tokens';

export interface StackProps extends ViewProps {
  direction?: 'row' | 'column';
  /** Gap between children, from the 4px spacing scale. */
  gap?: SpaceToken;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  /** Takes the remaining space along the parent's main axis. */
  flex?: number;
  /** Reverses the axis — used for RTL-agnostic ordering, not for layout tricks. */
  reverse?: boolean;
}

export function Stack({
  direction = 'column',
  gap = 0,
  align,
  justify,
  wrap = false,
  flex,
  reverse = false,
  style,
  ...rest
}: StackProps) {
  const flexDirection: ViewStyle['flexDirection'] = reverse
    ? direction === 'row'
      ? 'row-reverse'
      : 'column-reverse'
    : direction;

  return (
    <View
      {...rest}
      style={[
        {
          flexDirection,
          gap: space[gap],
          ...(align !== undefined && { alignItems: align }),
          ...(justify !== undefined && { justifyContent: justify }),
          ...(wrap && { flexWrap: 'wrap' as const }),
          ...(flex !== undefined && { flex }),
        },
        style,
      ]}
    />
  );
}

/** Vertical stack. */
export function VStack(props: Omit<StackProps, 'direction'>) {
  return <Stack {...props} direction="column" />;
}

/** Horizontal stack, vertically centred by default — the common case. */
export function HStack({ align = 'center', ...rest }: Omit<StackProps, 'direction'>) {
  return <Stack {...rest} direction="row" align={align} />;
}

/** Pushes siblings apart. Prefer `justify` on the parent where possible. */
export function Spacer({ size }: { size?: SpaceToken }) {
  if (size === undefined) return <View style={{ flex: 1 }} />;
  return <View style={{ width: space[size], height: space[size] }} />;
}
