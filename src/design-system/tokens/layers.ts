/**
 * Trackit X — stacking order.
 *
 * A single ordered scale prevents the z-index arms race. Anything that floats
 * must take its value from here.
 */
export const layers = {
  /** Default document flow. */
  base: 0,
  /** Hovered / selected row lifted above its siblings. */
  raised: 10,
  /** Sticky table headers and section headers. */
  sticky: 100,
  /** App chrome: top bar, sidebar, tab bar. */
  chrome: 200,
  /** Navigation drawer. */
  drawer: 300,
  /** Scrim behind a blocking surface. */
  scrim: 400,
  /** Modal dialog, bottom sheet. */
  modal: 500,
  /** Dropdown, menu, combobox popover. */
  popover: 600,
  /** Toasts and snackbars — above modals so confirmations are never hidden. */
  toast: 700,
  /** Tooltips. */
  tooltip: 800,
  /** Development overlays only. */
  debug: 900,
} as const;

export type Layer = keyof typeof layers;
