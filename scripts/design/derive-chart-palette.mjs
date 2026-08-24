#!/usr/bin/env node
/**
 * Trackit X — chart palette derivation & validation.
 *
 * The categorical chart palette is COMPUTED, not hand-picked. This script:
 *
 *  1. Takes the design system's hue ramps as candidate slots.
 *  2. For each mode, snaps every hue family to the ramp step that sits inside
 *     the OKLCH lightness band and clears the chroma floor.
 *  3. Enumerates slot orderings and keeps only those clearing every hard gate
 *     in BOTH light and dark, then picks the ordering that maximises the worst
 *     adjacent colour-vision-deficiency separation.
 *  4. Reports the resulting palette plus the series cap for all-pairs chart
 *     forms (scatter / bubble / choropleth / small multiples).
 *
 * Thresholds and the Machado-Oliveira-Fernandes (2009, severity 1.0) colour
 * vision simulation follow the data-visualisation standard. The maths is
 * inlined deliberately so this script stays runnable with zero dependencies.
 *
 * Usage:  node scripts/design/derive-chart-palette.mjs
 *
 * Re-run this whenever a chart colour changes and paste the output into
 * src/design-system/tokens/charts.ts.
 */

// ── thresholds ──────────────────────────────────────────────────────────────
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] }; // OKLCH L
const CHROMA_FLOOR = 0.1;
const CVD_TARGET = 8.0;
const CVD_FLOOR = 6.0;
const NORMAL_FLOOR = 15.0;
const CONTRAST_MIN = 3.0;

/** The surfaces Trackit X charts actually render on. */
const SURFACE = { light: '#FFFFFF', dark: '#12161D' };

// ── colour maths ────────────────────────────────────────────────────────────
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const hex2srgb = (h) => {
  const s = h.trim().replace(/^#/, '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (h) => hex2srgb(h).map(s2lin);
const relLum = (h) => {
  const [r, g, b] = lin(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const oklch = (h) => {
  const [L, a, b] = oklabFromLin(lin(h));
  return [L, Math.hypot(a, b)];
};
function simulate(h, kind) {
  const [r, g, b] = lin(h);
  const M = MACHADO[kind];
  const clamp = (c) => Math.max(0, Math.min(1, c));
  return [
    clamp(M[0][0] * r + M[0][1] * g + M[0][2] * b),
    clamp(M[1][0] * r + M[1][1] * g + M[1][2] * b),
    clamp(M[2][0] * r + M[2][1] * g + M[2][2] * b),
  ];
}
function deltaE(h1, h2, kind) {
  const a = oklabFromLin(kind ? simulate(h1, kind) : lin(h1));
  const b = oklabFromLin(kind ? simulate(h2, kind) : lin(h2));
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ── candidate ramps ─────────────────────────────────────────────────────────
// Every hue family the design system can spend on series identity, with the
// ramp steps the snapper may choose from.
const RAMPS = {
  indigo: ['#9CA9F8', '#7B8BF5', '#5B6FF0', '#4453D6', '#3540B0'],
  violet: ['#BEA4FF', '#A784FB', '#9061F9', '#7A45E6', '#6534BF'],
  cyan: ['#67E8F9', '#22D3EE', '#06B6D4', '#0891B2', '#0E7490'],
  emerald: ['#6EE7B7', '#34D399', '#10B981', '#059669', '#047857'],
  amber: ['#FCD34D', '#FBBF24', '#F59E0B', '#D97706', '#B45309'],
  red: ['#FCA5A5', '#F87171', '#EF4444', '#DC2626', '#B91C1C'],
  pink: ['#F9A8D4', '#F472B6', '#EC4899', '#DB2777', '#BE185D'],
  orange: ['#FDBA74', '#FB923C', '#F97316', '#EA580C', '#C2410C'],
  blue: ['#93C5FD', '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8'],
  lime: ['#BEF264', '#A3E635', '#84CC16', '#65A30D', '#4D7C0F'],
  teal: ['#5EEAD4', '#2DD4BF', '#14B8A6', '#0D9488', '#0F766E'],
};

/**
 * Snap a hue family to its best step for a mode.
 *
 * Constraints: inside the mode's OKLCH lightness band, above the chroma floor.
 * Preference: clear 3:1 against the surface this mode actually renders on
 * (dark surfaces want lighter marks, light surfaces want darker ones), then
 * maximise chroma so the hue keeps doing identity work.
 */
function snap(family, mode) {
  const [lo, hi] = BAND[mode];
  const surface = SURFACE[mode];
  const candidates = RAMPS[family]
    .map((hex) => {
      const [L, C] = oklch(hex);
      return { hex, L, C, contrast: contrast(hex, surface) };
    })
    .filter((c) => c.L >= lo && c.L <= hi && c.C >= CHROMA_FLOOR);
  if (candidates.length === 0) return null;

  const clearing = candidates.filter((c) => c.contrast >= CONTRAST_MIN);
  if (clearing.length > 0) {
    clearing.sort((a, b) => b.C - a.C || b.contrast - a.contrast);
    return clearing[0];
  }
  // Nothing in band reaches 3:1 — take the most legible step and flag relief.
  candidates.sort((a, b) => b.contrast - a.contrast || b.C - a.C);
  return candidates[0];
}

// ── scoring ─────────────────────────────────────────────────────────────────
function matrices(hexes) {
  const n = hexes.length;
  const cvd = Array.from({ length: n }, () => new Float64Array(n));
  const nor = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = Math.min(deltaE(hexes[i], hexes[j], 'protan'), deltaE(hexes[i], hexes[j], 'deutan'));
      const d = deltaE(hexes[i], hexes[j]);
      cvd[i][j] = cvd[j][i] = c;
      nor[i][j] = nor[j][i] = d;
    }
  }
  return { cvd, nor };
}

/** Worst adjacent pair values for one ordering under one mode's matrices. */
function scoreOrder(order, m) {
  let wc = Infinity;
  let wn = Infinity;
  for (let k = 0; k < order.length - 1; k++) {
    const a = order[k];
    const b = order[k + 1];
    if (m.cvd[a][b] < wc) wc = m.cvd[a][b];
    if (m.nor[a][b] < wn) wn = m.nor[a][b];
  }
  return { cvd: wc, normal: wn };
}

function* permutations(items, fixedFirst) {
  const n = items.length;
  const used = new Array(n).fill(false);
  const out = [];
  function* walk() {
    if (out.length === n) {
      yield out.slice();
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      if (out.length === 0 && fixedFirst !== undefined && i !== fixedFirst) continue;
      used[i] = true;
      out.push(i);
      yield* walk();
      out.pop();
      used[i] = false;
    }
  }
  yield* walk();
}

/** Longest leading prefix that clears the all-pairs gates in both modes. */
function allPairsCap(order, mats) {
  const passes = (len) => {
    for (const m of mats) {
      for (let i = 0; i < len; i++) {
        for (let j = i + 1; j < len; j++) {
          if (m.cvd[order[i]][order[j]] < CVD_FLOOR) return false;
          if (m.nor[order[i]][order[j]] < NORMAL_FLOOR) return false;
        }
      }
    }
    return true;
  };
  for (let len = order.length; len >= 2; len--) {
    if (!passes(len)) continue;
    let worstCvd = Infinity;
    let worstNormal = Infinity;
    for (const m of mats) {
      for (let i = 0; i < len; i++) {
        for (let j = i + 1; j < len; j++) {
          worstCvd = Math.min(worstCvd, m.cvd[order[i]][order[j]]);
          worstNormal = Math.min(worstNormal, m.nor[order[i]][order[j]]);
        }
      }
    }
    return { len, worstCvd, worstNormal };
  }
  return { len: 1, worstCvd: Infinity, worstNormal: Infinity };
}

// ── search ──────────────────────────────────────────────────────────────────
const SLOT_COUNT = 8;
/** Slot 1 is the brand indigo — the product's leading colour. */
const LEAD = 'indigo';

const pool = Object.keys(RAMPS);
const subsets = [];
(function choose(start, picked) {
  if (picked.length === SLOT_COUNT) {
    if (picked.includes(LEAD)) subsets.push(picked.slice());
    return;
  }
  for (let i = start; i < pool.length; i++) {
    picked.push(pool[i]);
    choose(i + 1, picked);
    picked.pop();
  }
})(0, []);

let best = null;

/**
 * Objective, in priority order:
 *   1. hard gates on the adjacent pairlist in BOTH modes (filter, not score)
 *   2. maximise the all-pairs series cap — how many series scatter/bubble/map
 *      forms can carry before identity collapses
 *   3. maximise the worst adjacent CVD separation
 *   4. minimise the number of fills needing contrast relief
 *   5. maximise the worst adjacent normal-vision separation
 */
function better(candidate, incumbent) {
  if (incumbent === null) return true;
  const keys = ['capLen', 'worstCvd', 'reliefScore', 'worstNormal'];
  for (const key of keys) {
    if (candidate[key] !== incumbent[key]) return candidate[key] > incumbent[key];
  }
  return false;
}

for (const families of subsets) {
  const light = families.map((f) => snap(f, 'light'));
  const dark = families.map((f) => snap(f, 'dark'));
  if (light.some((c) => c === null) || dark.some((c) => c === null)) continue;

  const mats = [matrices(light.map((c) => c.hex)), matrices(dark.map((c) => c.hex))];
  const leadIndex = families.indexOf(LEAD);

  // Relief count depends only on the chosen steps, not on their order.
  const reliefCount =
    light.filter((c) => c.contrast < CONTRAST_MIN).length +
    dark.filter((c) => c.contrast < CONTRAST_MIN).length;

  for (const order of permutations(families, leadIndex)) {
    const s0 = scoreOrder(order, mats[0]);
    const s1 = scoreOrder(order, mats[1]);
    if (s0.normal < NORMAL_FLOOR || s1.normal < NORMAL_FLOOR) continue;
    if (s0.cvd < CVD_FLOOR || s1.cvd < CVD_FLOOR) continue;

    const cap = allPairsCap(order, mats);
    const candidate = {
      capLen: cap.len,
      worstCvd: Math.min(s0.cvd, s1.cvd),
      worstNormal: Math.min(s0.normal, s1.normal),
      reliefScore: -reliefCount,
      light: s0,
      dark: s1,
      families: order.map((i) => families[i]),
      lightHex: order.map((i) => light[i].hex),
      darkHex: order.map((i) => dark[i].hex),
      cap,
    };
    if (better(candidate, best)) best = candidate;
  }
}

// ── report ──────────────────────────────────────────────────────────────────
if (!best) {
  console.error('No ordering cleared every hard gate in both modes.');
  process.exit(1);
}

const state = (v) => (v >= CVD_TARGET ? 'PASS' : v >= CVD_FLOOR ? 'WARN(floor)' : 'FAIL');

console.log('\nTRACKIT X — CATEGORICAL CHART PALETTE (derived)\n');
console.log(`Searched ${subsets.length} hue subsets of ${pool.length} families, slot 1 fixed to ${LEAD}.`);
console.log(`Surfaces: light ${SURFACE.light}  dark ${SURFACE.dark}\n`);

console.log('| Slot | Hue     | Light     | Dark      | L(light) | L(dark) | c:light | c:dark |');
console.log('|------|---------|-----------|-----------|----------|---------|---------|--------|');
best.families.forEach((f, i) => {
  const lh = best.lightHex[i];
  const dh = best.darkHex[i];
  console.log(
    `| ${String(i + 1).padEnd(4)} | ${f.padEnd(7)} | \`${lh}\` | \`${dh}\` |` +
      ` ${oklch(lh)[0].toFixed(3).padStart(8)} | ${oklch(dh)[0].toFixed(3).padStart(7)} |` +
      ` ${contrast(lh, SURFACE.light).toFixed(2).padStart(7)} | ${contrast(dh, SURFACE.dark).toFixed(2).padStart(6)} |`,
  );
});

console.log('\nADJACENT PAIRLIST (bars, stacks, lines)');
console.log(`  worst CVD ΔE      light ${best.light.cvd.toFixed(1)}  dark ${best.dark.cvd.toFixed(1)}   → ${state(best.worstCvd)} (target ${CVD_TARGET}, floor ${CVD_FLOOR})`);
console.log(`  worst normal ΔE   light ${best.light.normal.toFixed(1)}  dark ${best.dark.normal.toFixed(1)}   → ${best.worstNormal >= NORMAL_FLOOR ? 'PASS' : 'FAIL'} (floor ${NORMAL_FLOOR})`);

console.log('\nALL-PAIRS SERIES CAP (scatter, bubble, choropleth, small multiples)');
console.log(`  first ${best.cap.len} slots clear all-pairs gates in both modes`);
console.log(`  worst pair CVD ΔE ${best.cap.worstCvd.toFixed(1)} · normal ΔE ${best.cap.worstNormal.toFixed(1)}`);console.log(`  → cap chart forms with any-two-marks-adjacent at ${best.cap.len} series; fold the rest to "Other" or facet.`);

const reliefLight = best.lightHex.filter((h) => contrast(h, SURFACE.light) < CONTRAST_MIN);
const reliefDark = best.darkHex.filter((h) => contrast(h, SURFACE.dark) < CONTRAST_MIN);
console.log('\nCONTRAST RELIEF (sub-3:1 fills require visible labels or a table view)');
console.log(`  light: ${reliefLight.length ? reliefLight.join(', ') : 'none'}`);
console.log(`  dark:  ${reliefDark.length ? reliefDark.join(', ') : 'none'}`);

console.log('\nCopy-paste rows:');
console.log(`  light: ${best.lightHex.map((h) => `'${h}'`).join(', ')}`);
console.log(`  dark:  ${best.darkHex.map((h) => `'${h}'`).join(', ')}`);
console.log('');

// ───────────────────────────────────────────────────────────────────────────
// Ordinal / sequential ramps and the diverging pair.
//
// These are NOT judged by the categorical six checks (running those on a ramp
// fails by design — a ramp spans the lightness band on purpose). The gates are:
// monotone lightness, adjacent ΔL >= 0.06, and the step nearest the surface
// still clearing 2:1 so the light end does not dissolve into the background.
// ───────────────────────────────────────────────────────────────────────────
const ORDINAL_MIN_DL = 0.06;
const ORDINAL_LIGHT_FLOOR = 2.0;

function checkRamp(name, steps, mode, { floor = ORDINAL_LIGHT_FLOOR } = {}) {
  const surface = SURFACE[mode];
  const rows = steps.map((hex) => ({ hex, L: oklch(hex)[0], c: contrast(hex, surface) }));
  const monotoneUp = rows.every((r, i) => i === 0 || r.L > rows[i - 1].L);
  const monotoneDown = rows.every((r, i) => i === 0 || r.L < rows[i - 1].L);
  const monotone = monotoneUp || monotoneDown;

  let minDL = Infinity;
  for (let i = 1; i < rows.length; i++) minDL = Math.min(minDL, Math.abs(rows[i].L - rows[i - 1].L));

  // The step nearest the surface is the one with the lowest contrast against it.
  const nearest = rows.reduce((a, b) => (a.c <= b.c ? a : b));

  const pass = monotone && minDL >= ORDINAL_MIN_DL && nearest.c >= floor;
  console.log(
    `  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${mode.padEnd(5)}  ` +
      `monotone ${monotone ? 'yes' : 'NO '}  minΔL ${minDL.toFixed(3)}  ` +
      `nearest-surface ${nearest.hex} ${nearest.c.toFixed(2)}:1` +
      (floor === 0 ? '  (no floor: sequential low end may recede)' : ` (floor ${floor.toFixed(1)})`),
  );
  return pass;
}

// Sequential: one hue, light -> dark on a light surface; the anchor flips on
// dark so "near zero" is always the end closest to the surface. The step
// nearest the surface is exempt from the 2:1 floor by design — on a continuous
// magnitude scale it encodes "near zero" and is meant to recede.
const SEQ_LIGHT = ['#DEE4FD', '#BFC9FB', '#9CA9F8', '#7B8BF5', '#5B6FF0', '#4453D6', '#3540B0'];
const SEQ_DARK = ['#1D2366', '#28308A', '#3540B0', '#4453D6', '#5B6FF0', '#7B8BF5', '#9CA9F8'];

// Ordinal: discrete ordered marks (funnel stages, priority tiers, age buckets).
// Trimmed at the surface end so every swatch stays visible.
const ORD_LIGHT = ['#9CA9F8', '#7B8BF5', '#5B6FF0', '#4453D6', '#3540B0'];
const ORD_DARK = ['#3540B0', '#4453D6', '#5B6FF0', '#7B8BF5', '#9CA9F8'];

// Diverging: indigo (favourable) <-> red (unfavourable) with a neutral grey
// midpoint. Listed inner (next to the midpoint) -> outer (extreme). The inner
// step must still clear 2:1 or the first meaningful deviation is invisible, and
// the red arm skips ramp step 500 because 500->600 is only ΔL 0.060.
const DIV_RED_LIGHT = ['#F87171', '#DC2626', '#B91C1C', '#991B1B'];
const DIV_RED_DARK = ['#991B1B', '#B91C1C', '#DC2626', '#F87171'];
const DIV_INDIGO_LIGHT = ['#9CA9F8', '#7B8BF5', '#5B6FF0', '#4453D6'];
const DIV_INDIGO_DARK = ['#3540B0', '#4453D6', '#5B6FF0', '#7B8BF5'];

console.log('SEQUENTIAL / ORDINAL / DIVERGING RAMP GATES');
console.log('  (monotone lightness · adjacent ΔL >= 0.06 · surface-nearest step >= 2:1)\n');
let rampsOk = true;
rampsOk = checkRamp('sequential indigo', SEQ_LIGHT, 'light', { floor: 0 }) && rampsOk;
rampsOk = checkRamp('sequential indigo', SEQ_DARK, 'dark', { floor: 0 }) && rampsOk;
rampsOk = checkRamp('ordinal indigo', ORD_LIGHT, 'light') && rampsOk;
rampsOk = checkRamp('ordinal indigo', ORD_DARK, 'dark') && rampsOk;
rampsOk = checkRamp('diverging arm (red)', DIV_RED_LIGHT, 'light') && rampsOk;
rampsOk = checkRamp('diverging arm (red)', DIV_RED_DARK, 'dark') && rampsOk;
rampsOk = checkRamp('diverging arm (indigo)', DIV_INDIGO_LIGHT, 'light') && rampsOk;
rampsOk = checkRamp('diverging arm (indigo)', DIV_INDIGO_DARK, 'dark') && rampsOk;

// The two diverging poles must read as opposite, so gate them like a series pair.
const poleLight = Math.min(
  deltaE('#4453D6', '#991B1B', 'protan'),
  deltaE('#4453D6', '#991B1B', 'deutan'),
);
const poleDark = Math.min(
  deltaE('#7B8BF5', '#F87171', 'protan'),
  deltaE('#7B8BF5', '#F87171', 'deutan'),
);
console.log(
  `\n  Diverging poles CVD ΔE — light ${poleLight.toFixed(1)}  dark ${poleDark.toFixed(1)}  ` +
    `(${Math.min(poleLight, poleDark) >= CVD_TARGET ? 'PASS' : 'CHECK'}, target ${CVD_TARGET})`,
);
console.log(`  Neutral midpoint reads as "nothing": light #EDEFF3 · dark #2A303B (grey, no hue)\n`);

if (!rampsOk) {
  console.error('One or more ramps failed their gates — fix before shipping.');
  process.exit(1);
}

