/**
 * Trackit X — hero backdrop.
 *
 * The layer that is always there. It costs one composited gradient, has no
 * animation and no deferred import, so the hero has a finished dark surface on the
 * very first frame regardless of what else succeeds. Everything richer —
 * `LazyOrbit` — draws on top of this and is allowed to fail.
 *
 * Stops are built with `withAlpha` rather than the string `'transparent'`: on iOS a
 * transparent stop interpolates through transparent *black*, which greys the
 * midpoint of a coloured wash. Fading a colour to its own zero-alpha keeps the hue
 * constant all the way down.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useTheme, withAlpha } from '@/design-system';

export function HeroBackdrop() {
  const theme = useTheme();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Base: lifted very slightly through the middle, so the surface has a
          centre of gravity instead of reading as flat black. */}
      <LinearGradient
        colors={[theme.colors.canvas, theme.colors.surface, theme.colors.canvas]}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Brand light from the upper right, where the visualization sits. */}
      <LinearGradient
        colors={[withAlpha(theme.colors.accent.fg, 0.08), withAlpha(theme.colors.accent.fg, 0)]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.15, y: 0.85 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Cool counterweight low on the opposite side — depth needs two lights. */}
      <LinearGradient
        colors={[withAlpha(theme.colors.ai.fg, 0), withAlpha(theme.colors.ai.fg, 0.07)]}
        start={{ x: 0.6, y: 0.2 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Settles back to the canvas at the bottom edge so the hero hands over to
          the next section without a seam. */}
      <LinearGradient
        colors={[withAlpha(theme.colors.canvas, 0), theme.colors.canvas]}
        locations={[0.72, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
