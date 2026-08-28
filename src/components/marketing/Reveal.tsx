/**
 * Trackit X — Reveal.
 *
 * A one-line way to bring a block onto the screen. It exists so a section can
 * stagger its children by passing delays, without every section growing its own
 * animated wrapper — and so `useEntrance` is called from a component that mounts
 * with the thing it reveals.
 *
 * Wrap the *cell*, not the card: the wrapper participates in layout, so grid
 * sizing (`flexBasis`, `minWidth`) belongs on `style` here rather than on the child.
 */
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useEntrance } from '@/design-system';

export interface RevealProps {
  /** Position in the reveal sequence, in milliseconds. */
  delay?: number;
  /** Travel distance. 0 fades in place. */
  distance?: number;
  style?: ViewStyle;
  children: ReactNode;
}

export function Reveal({ delay, distance, style, children }: RevealProps) {
  const entrance = useEntrance({ delay, distance });

  return <Animated.View style={[style, entrance]}>{children}</Animated.View>;
}
