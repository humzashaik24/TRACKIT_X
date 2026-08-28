/**
 * Trackit X — deferred hero visualization.
 *
 * `AIOrbit` is loaded with a dynamic `import()` rather than a static one, so the
 * hero's headline and call to action are not waiting behind the visual layer in the
 * bundle. The requirement it satisfies — "the immersive layer must be lazy-loaded,
 * and the page must remain usable without it" — is a real one on a landing page,
 * where the first thing a visitor needs is the sentence, not the animation.
 *
 * ── Why a promise and state, not `React.lazy` ───────────────────────────────
 * `React.lazy` propagates a failed chunk load as a render-time throw, which needs
 * an error boundary to avoid taking the route down with it. Here a failure resolves
 * to "no visualization": `HeroBackdrop` is already painted underneath, so the hero
 * degrades to a gradient and stays completely usable. The failure is reported once
 * to the console rather than swallowed.
 *
 * The entrance lives in a child component on purpose. Mounting it only after the
 * module resolves is what makes the reveal start when the orbit actually appears,
 * instead of running to completion behind a `null`.
 */
import { useEffect, useState, type ComponentType } from 'react';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useEntrance } from '@/design-system';

import type { AIOrbitProps } from './AIOrbit';

export interface LazyOrbitProps extends AIOrbitProps {
  style?: ViewStyle;
}

type OrbitComponent = ComponentType<AIOrbitProps>;

function OrbitLayer({
  Orbit,
  size,
  lightweight,
  style,
}: LazyOrbitProps & { Orbit: OrbitComponent }) {
  // No travel, only a slow scale and fade: the orbit is behind the copy, and a
  // background that slides is a background that competes.
  const entrance = useEntrance({ distance: 0, scaleFrom: 0.94, duration: 900 });

  return (
    <Animated.View pointerEvents="none" style={[style, entrance]}>
      <Orbit size={size} lightweight={lightweight} />
    </Animated.View>
  );
}

export function LazyOrbit({ size, lightweight, style }: LazyOrbitProps) {
  const [Orbit, setOrbit] = useState<OrbitComponent | null>(null);

  useEffect(() => {
    let alive = true;
    void import('./AIOrbit')
      .then((module) => {
        // The updater form is required: passing a component straight to a setter
        // would be treated as a state updater function and called.
        if (alive) setOrbit(() => module.AIOrbit);
      })
      .catch((cause: unknown) => {
        console.warn('Trackit X: the hero visualization could not be loaded.', cause);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (Orbit === null) return null;

  return <OrbitLayer Orbit={Orbit} size={size} lightweight={lightweight} style={style} />;
}
