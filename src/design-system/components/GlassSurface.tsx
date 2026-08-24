/**
 * Trackit X — GlassSurface.
 *
 * The glass layer used by floating chrome, modals, sheets and feature cards. It
 * composes three things a plain blur does not give you:
 *
 *   1. a translucent tint over the blur, so content behind it stays legible
 *   2. a hairline sheen along the top edge, which is what makes the surface read
 *      as a physical pane rather than as a blurry rectangle
 *   3. a border that survives on top of whatever is behind it
 *
 * Android note: real-time blur on Android is expensive and historically janky,
 * so glass falls back to a solid raised surface there by default. Pass
 * `blurOnAndroid` to opt a specific surface in.
 */
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { radius, type RadiusToken } from '../tokens';

export interface GlassSurfaceProps extends ViewProps {
  /** Blur strength, 0–100. */
  intensity?: number;
  /** Stronger tint for chrome that must stay readable over busy content. */
  strong?: boolean;
  corner?: RadiusToken;
  /** Draw the top-edge highlight. On by default — it is the point of glass. */
  sheen?: boolean;
  bordered?: boolean;
  /** Opt into real blur on Android, accepting the performance cost. */
  blurOnAndroid?: boolean;
}

export function GlassSurface({
  intensity = 28,
  strong = false,
  corner = 'lg',
  sheen = true,
  bordered = true,
  blurOnAndroid = false,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const theme = useTheme();
  const useBlur = Platform.OS !== 'android' || blurOnAndroid;

  const tint = strong ? theme.colors.surfaceGlassStrong : theme.colors.surfaceGlass;
  const container = [
    {
      borderRadius: radius[corner],
      overflow: 'hidden' as const,
      ...(bordered && { borderWidth: 1, borderColor: theme.colors.border }),
    },
    style,
  ];

  const overlay = (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" />
      {sheen && (
        <LinearGradient
          colors={theme.gradients.sheen}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.sheen}
          pointerEvents="none"
        />
      )}
    </>
  );

  if (!useBlur) {
    return (
      <View {...rest} style={[{ backgroundColor: theme.colors.surfaceRaised }, ...container]}>
        {overlay}
        {children}
      </View>
    );
  }

  return (
    <BlurView
      {...rest}
      intensity={intensity}
      tint={theme.isDark ? 'dark' : 'light'}
      style={container}
    >
      {overlay}
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Tall enough to read as a light source, short enough to stay an edge.
    height: 64,
  },
});
