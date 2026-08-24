/**
 * Trackit X — motion tokens.
 *
 * Deliberately dependency-free: curves are stored as raw cubic-bezier control
 * points and springs as plain configuration objects. Components construct the
 * Reanimated `Easing`/`withSpring` values themselves, which keeps these tokens
 * importable from tests and from non-animated code paths.
 *
 * Motion in Trackit X is informational, not decorative. Every transition should
 * explain where something came from or draw attention to a state change.
 */

export type BezierCurve = readonly [number, number, number, number];

export interface SpringConfig {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
}

export const motion = {
  duration: {
    /** No animation — respects reduce-motion. */
    instant: 0,
    /** Micro-interaction: press feedback, hover. */
    fast: 120,
    /** Default UI transition: fades, small translations. */
    base: 200,
    /** Entering surfaces: cards, dropdowns. */
    slow: 320,
    /** Full-screen surfaces: modals, sheets, route changes. */
    slower: 460,
    /** Ambient, looping effects: shimmer, pulse, AI thinking. */
    ambient: 1400,
  },

  curve: {
    /** General purpose ease-in-out. */
    standard: [0.2, 0, 0, 1] as BezierCurve,
    /** Things arriving on screen — fast out of the gate, gentle landing. */
    entrance: [0.05, 0.7, 0.1, 1] as BezierCurve,
    /** Things leaving — slow start, quick exit. */
    exit: [0.3, 0, 0.8, 0.15] as BezierCurve,
    /** Expressive emphasis for hero moments. */
    emphasized: [0.34, 1.56, 0.64, 1] as BezierCurve,
    linear: [0, 0, 1, 1] as BezierCurve,
  },

  spring: {
    /** Crisp and controlled — buttons, toggles, chips. */
    snappy: { damping: 22, stiffness: 260, mass: 1 } as SpringConfig,
    /** Calm — cards, panels, layout shifts. */
    gentle: { damping: 26, stiffness: 140, mass: 1 } as SpringConfig,
    /** Playful overshoot — success confirmations only. */
    bouncy: { damping: 12, stiffness: 200, mass: 0.9 } as SpringConfig,
    /** Heavy surfaces — bottom sheets, drawers. */
    sheet: { damping: 30, stiffness: 190, mass: 1.1 } as SpringConfig,
  },

  /** Per-item delay when animating a collection in. */
  stagger: {
    list: 38,
    grid: 26,
    /** Cap total stagger so long lists do not feel sluggish. */
    maxItems: 12,
  },

  /** Scale applied while a control is pressed. */
  pressScale: 0.975,
} as const;

/**
 * Stagger delay for item `index`, capped so the tail of a long list is not
 * left waiting.
 */
export function staggerDelay(index: number, step: number = motion.stagger.list): number {
  return Math.min(index, motion.stagger.maxItems) * step;
}
