/**
 * Trackit X — AIOrbit.
 *
 * The hero visualization: an operating system reading a business. A core that
 * reasons, six operational domains around it, and data moving along the spokes
 * between them. It is composed, not diagrammatic — nobody should be able to point
 * at a node and ask which table it is.
 *
 * ── Why this is not Three.js ────────────────────────────────────────────────
 * The project has no 3D stack installed (no three, no @react-three/fiber, no
 * Skia), and adding one to an Expo 57 / React 19 app is a dependency decision with
 * its own verification, not a detail of a visual phase. So depth here is built
 * from what ships with the app: layered translucency, proportional scale, and
 * motion at different speeds per layer. Every transform is `opacity`, `scale`,
 * `translate` or `rotate`, which is what Reanimated runs off the JS thread.
 *
 * ── Geometry is proportional, not tokenised ─────────────────────────────────
 * Sizes below are fractions of `size` rather than spacing-scale steps. A circle
 * whose ring radii were snapped to a 4px grid stops being concentric the moment
 * the container resizes; the spacing scale governs layout, and this is a drawing.
 *
 * ── Reduce-motion ───────────────────────────────────────────────────────────
 * Every animated part has a defined resting state and is assigned it outright when
 * the setting is on. Nothing is merely slowed down, and nothing that carries
 * meaning is communicated by movement alone — the nodes are labelled for assistive
 * technology and the whole layer is decorative besides.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon, motion, useReducedMotion, useTheme, withAlpha, type IconName } from '@/design-system';

export interface AIOrbitProps {
  /** Diameter of the whole composition, in px. */
  size: number;
  /**
   * Phone mode: fewer nodes, no travelling particles, no ambient glow drift.
   * The composition still reads — it just stops paying for depth on a device that
   * would show the cost as dropped frames.
   */
  lightweight?: boolean;
}

interface NodeSpec {
  readonly icon: IconName;
  readonly label: string;
  /** Degrees clockwise from "east", matching screen coordinates. */
  readonly angle: number;
  /** Distance from the core as a fraction of the radius. */
  readonly reach: number;
  /** Offset into the ambient loop, so the network does not breathe in unison. */
  readonly delay: number;
  /** Kept in lightweight mode. */
  readonly essential: boolean;
}

/**
 * Deliberately irregular. Six nodes at exact 60° intervals read as a logo; an
 * uneven ring with varying reach reads as a system that grew.
 */
const NODES: readonly NodeSpec[] = [
  { icon: 'projects', label: 'Projects', angle: -128, reach: 0.86, delay: 0, essential: true },
  { icon: 'employees', label: 'People', angle: -54, reach: 0.68, delay: 520, essential: true },
  { icon: 'finance', label: 'Finance', angle: 8, reach: 0.88, delay: 1040, essential: true },
  { icon: 'inventory', label: 'Inventory', angle: 68, reach: 0.71, delay: 1560, essential: false },
  { icon: 'tasks', label: 'Tasks', angle: 140, reach: 0.82, delay: 2080, essential: false },
  { icon: 'aiInsight', label: 'Insights', angle: 202, reach: 0.62, delay: 2600, essential: false },
];

const BREATH_MS = 2400;
const FLOW_MS = 3200;
const PULSE_MS = 2600;

function polar(angle: number, length: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return { x: Math.cos(radians) * length, y: Math.sin(radians) * length };
}

// ---------------------------------------------------------------------------
// Ambient glow — the light the composition sits in
// ---------------------------------------------------------------------------

interface GlowProps {
  diameter: number;
  colors: readonly [string, string];
  left: number;
  top: number;
  delay: number;
  animate: boolean;
}

/**
 * A soft light source. `expo-linear-gradient` has no radial mode, so the falloff
 * is one-directional inside a circular clip: opaque at the top edge, transparent
 * at the bottom. That reads as light coming from somewhere rather than as a disc,
 * which is the whole requirement.
 */
function AmbientGlow({ diameter, colors, left, top, delay, animate }: GlowProps) {
  const drift = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      drift.value = 0.5;
      return;
    }
    drift.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 7000, easing: Easing.bezier(...motion.curve.standard) }),
          withTiming(0, { duration: 7000, easing: Easing.bezier(...motion.curve.standard) }),
        ),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(drift);
    };
  }, [animate, delay, drift]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + drift.value * 0.45,
    transform: [
      { translateX: (drift.value - 0.5) * diameter * 0.08 },
      { translateY: (0.5 - drift.value) * diameter * 0.06 },
      { scale: 0.94 + drift.value * 0.12 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left,
          top,
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <LinearGradient
        colors={colors}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Spoke — the connection, and the data on it
// ---------------------------------------------------------------------------

interface SpokeProps {
  size: number;
  angle: number;
  length: number;
  delay: number;
  lineColor: string;
  particleColor: string;
  animate: boolean;
}

/**
 * The rotation trick: the wrapper is the full `size` square, so it rotates about
 * the composition's centre without needing `transformOrigin` (which is newer than
 * some of the surfaces this runs on). The line is then simply drawn eastward from
 * the centre and carried around by the wrapper's rotation.
 */
function Spoke({
  size,
  angle,
  length,
  delay,
  lineColor,
  particleColor,
  animate,
}: SpokeProps) {
  const flow = useSharedValue(0);
  const centre = size / 2;

  useEffect(() => {
    if (!animate) {
      flow.value = 0;
      return;
    }
    flow.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: FLOW_MS, easing: Easing.linear }), -1, false),
    );
    return () => {
      cancelAnimation(flow);
    };
  }, [animate, delay, flow]);

  const particleStyle = useAnimatedStyle(() => ({
    // Fades in and out at the ends so a dot never appears from nothing at the
    // core or piles up against the node.
    opacity: interpolate(flow.value, [0, 0.12, 0.86, 1], [0, 1, 1, 0]),
    transform: [{ translateX: flow.value * length }],
  }));

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: size,
        height: size,
        transform: [{ rotate: `${angle}deg` }],
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: centre,
          top: centre - 0.5,
          width: length,
          height: 1,
          backgroundColor: lineColor,
        }}
      />
      {animate && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: centre,
              top: centre - 2.5,
              width: 5,
              height: 5,
              borderRadius: 2.5,
              backgroundColor: particleColor,
            },
            particleStyle,
          ]}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Node — one operational domain
// ---------------------------------------------------------------------------

interface OrbitNodeProps {
  spec: NodeSpec;
  diameter: number;
  left: number;
  top: number;
  animate: boolean;
}

function OrbitNode({ spec, diameter, left, top, animate }: OrbitNodeProps) {
  const theme = useTheme();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      breath.value = 0.6;
      return;
    }
    breath.value = withDelay(
      spec.delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: BREATH_MS, easing: Easing.bezier(...motion.curve.standard) }),
          withTiming(0, { duration: BREATH_MS, easing: Easing.bezier(...motion.curve.standard) }),
        ),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(breath);
    };
  }, [animate, breath, spec.delay]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.62 + breath.value * 0.38,
    transform: [{ scale: 0.97 + breath.value * 0.05 }],
  }));

  return (
    <Animated.View
      // Decorative as a picture, but the domains it names are the product's
      // substance — so the label is available rather than lost to the image.
      accessible
      accessibilityRole="image"
      accessibilityLabel={spec.label}
      style={[
        {
          position: 'absolute',
          left,
          top,
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceRaised,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <Icon name={spec.icon} size={Math.round(diameter * 0.42)} tone="secondary" />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Core — the part that reasons
// ---------------------------------------------------------------------------

function Core({ size, animate }: { size: number; animate: boolean }) {
  const theme = useTheme();
  const pulse = useSharedValue(0);

  const core = Math.round(size * 0.2);
  const halo = Math.round(size * 0.36);

  useEffect(() => {
    if (!animate) {
      pulse.value = 0.4;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_MS, easing: Easing.bezier(...motion.curve.standard) }),
        withTiming(0, { duration: PULSE_MS, easing: Easing.bezier(...motion.curve.standard) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [animate, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.16 + pulse.value * 0.3,
    transform: [{ scale: 0.88 + pulse.value * 0.2 }],
  }));

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: (size - halo) / 2,
            top: (size - halo) / 2,
            width: halo,
            height: halo,
            borderRadius: halo / 2,
            backgroundColor: theme.colors.accent.subtle,
            borderWidth: 1,
            borderColor: theme.colors.accent.border,
          },
          haloStyle,
        ]}
      />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Trackit X intelligence core"
        style={{
          position: 'absolute',
          left: (size - core) / 2,
          top: (size - core) / 2,
          width: core,
          height: core,
          borderRadius: core / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceOverlay,
          borderWidth: 1,
          borderColor: theme.colors.accent.border,
          ...theme.shadows.lg,
        }}
      >
        <Icon name="aiBrain" size={Math.round(core * 0.44)} tone="accent" />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function AIOrbit({ size, lightweight = false }: AIOrbitProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;

  const radius = size / 2;
  const nodeDiameter = Math.max(34, Math.min(54, Math.round(size * 0.115)));
  const nodes = lightweight ? NODES.filter((n) => n.essential) : NODES;

  const lineColor = theme.colors.borderSubtle;
  const activeLine = withAlpha(theme.colors.accent.fg, 0.28);

  /** Concentric guides. Two is enough to imply depth; three starts to look technical. */
  const rings = [0.58, 0.94];

  return (
    <View
      // The whole layer is decoration behind live content: it must never eat a tap
      // meant for the call to action underneath it.
      pointerEvents="none"
      style={{ width: size, height: size }}
    >
      <AmbientGlow
        diameter={size * 0.9}
        colors={theme.gradients.glow}
        left={size * 0.1}
        top={-size * 0.06}
        delay={0}
        animate={animate && !lightweight}
      />
      <AmbientGlow
        diameter={size * 0.78}
        colors={[withAlpha(theme.colors.ai.fg, 0.2), withAlpha(theme.colors.ai.fg, 0)]}
        left={-size * 0.12}
        top={size * 0.3}
        delay={2400}
        animate={animate && !lightweight}
      />

      {rings.map((scale) => {
        const diameter = size * scale;
        return (
          <View
            key={scale}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: (size - diameter) / 2,
              top: (size - diameter) / 2,
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              borderWidth: 1,
              borderColor: theme.colors.borderSubtle,
            }}
          />
        );
      })}

      {nodes.map((spec, index) => (
        <Spoke
          key={spec.label}
          size={size}
          angle={spec.angle}
          length={radius * spec.reach}
          delay={spec.delay}
          lineColor={index % 2 === 0 ? activeLine : lineColor}
          particleColor={theme.colors.accent.fg}
          animate={animate && !lightweight}
        />
      ))}

      <Core size={size} animate={animate} />

      {nodes.map((spec) => {
        const { x, y } = polar(spec.angle, radius * spec.reach);
        return (
          <OrbitNode
            key={spec.label}
            spec={spec}
            diameter={nodeDiameter}
            left={radius + x - nodeDiameter / 2}
            top={radius + y - nodeDiameter / 2}
            animate={animate}
          />
        );
      })}
    </View>
  );
}
