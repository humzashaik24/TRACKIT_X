/**
 * Trackit X — Icon.
 *
 * Screens reference *semantic* names ("inventory", "aiAgent", "riskAlert"), not
 * glyph names from a specific icon set. The mapping lives here alone, so the
 * icon set can be swapped — or individual glyphs re-chosen — without touching a
 * single screen. Adding an icon means adding a row to this registry.
 *
 * Sizes come from the `iconSize` token scale so icons stay in proportion with
 * the control heights they sit inside.
 */
import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { iconSize, type IconSizeToken } from '../tokens';
import { toneColor, type TextTone } from './Text';

type Glyph =
  | { family: 'feather'; name: ComponentProps<typeof Feather>['name'] }
  | { family: 'ionicons'; name: ComponentProps<typeof Ionicons>['name'] }
  | { family: 'material'; name: ComponentProps<typeof MaterialCommunityIcons>['name'] };

const feather = (name: ComponentProps<typeof Feather>['name']): Glyph => ({
  family: 'feather',
  name,
});
const ionicon = (name: ComponentProps<typeof Ionicons>['name']): Glyph => ({
  family: 'ionicons',
  name,
});
const material = (name: ComponentProps<typeof MaterialCommunityIcons>['name']): Glyph => ({
  family: 'material',
  name,
});

/**
 * The product's icon vocabulary. Feather carries the interface (its 2px stroke
 * matches the type), with Material Community filling the business and AI
 * concepts Feather has no glyph for.
 */
export const icons = {
  // --- Navigation / modules ------------------------------------------------
  dashboard: feather('grid'),
  projects: feather('layers'),
  tasks: feather('check-square'),
  employees: feather('users'),
  attendance: feather('clock'),
  payroll: feather('dollar-sign'),
  finance: feather('credit-card'),
  inventory: feather('package'),
  warehouse: material('warehouse'),
  suppliers: feather('truck'),
  customers: feather('user-check'),
  reports: feather('bar-chart-2'),
  knowledge: feather('book-open'),
  settings: feather('settings'),
  organization: material('sitemap-outline'),
  notifications: feather('bell'),
  documents: feather('file-text'),
  calendar: feather('calendar'),
  assets: feather('box'),
  maintenance: material('wrench-outline'),
  quality: material('clipboard-check-outline'),

  // --- AI ------------------------------------------------------------------
  ai: material('robot-outline'),
  aiAgent: material('robot-outline'),
  aiBrain: material('brain'),
  aiSpark: ionicon('sparkles-outline'),
  aiAutomation: material('auto-fix'),
  aiInsight: material('lightbulb-on-outline'),
  aiCopilot: feather('message-square'),
  businessDna: material('dna'),
  digitalTwin: material('flask-outline'),
  simulation: material('chart-bell-curve'),
  workflow: material('sitemap-outline'),

  // --- Status / signals ----------------------------------------------------
  success: feather('check-circle'),
  warning: feather('alert-triangle'),
  danger: feather('x-circle'),
  info: feather('info'),
  riskAlert: feather('alert-octagon'),
  pending: feather('loader'),
  blocked: feather('slash'),
  trendUp: feather('trending-up'),
  trendDown: feather('trending-down'),
  target: feather('target'),
  health: feather('activity'),
  live: feather('radio'),
  shield: feather('shield'),
  approved: material('shield-check-outline'),

  // --- Actions -------------------------------------------------------------
  add: feather('plus'),
  edit: feather('edit-2'),
  delete: feather('trash-2'),
  close: feather('x'),
  check: feather('check'),
  search: feather('search'),
  filter: feather('filter'),
  sort: feather('sliders'),
  refresh: feather('refresh-cw'),
  download: feather('download'),
  upload: feather('upload'),
  share: feather('share-2'),
  copy: feather('copy'),
  send: feather('send'),
  attach: feather('paperclip'),
  externalLink: feather('external-link'),
  more: feather('more-horizontal'),
  moreVertical: feather('more-vertical'),
  menu: feather('menu'),
  logout: feather('log-out'),
  retry: feather('rotate-ccw'),
  expand: feather('maximize-2'),
  collapse: feather('minimize-2'),
  sidebar: feather('sidebar'),
  print: feather('printer'),

  // --- Direction -----------------------------------------------------------
  chevronUp: feather('chevron-up'),
  chevronDown: feather('chevron-down'),
  chevronLeft: feather('chevron-left'),
  chevronRight: feather('chevron-right'),
  arrowUp: feather('arrow-up'),
  arrowDown: feather('arrow-down'),
  arrowLeft: feather('arrow-left'),
  arrowRight: feather('arrow-right'),

  // --- Identity / misc -----------------------------------------------------
  user: feather('user'),
  team: feather('users'),
  lock: feather('lock'),
  unlock: feather('unlock'),
  key: feather('key'),
  eye: feather('eye'),
  eyeOff: feather('eye-off'),
  mail: feather('mail'),
  location: feather('map-pin'),
  tag: feather('tag'),
  chart: feather('pie-chart'),
  database: feather('database'),
  empty: feather('inbox'),
  theme: feather('moon'),
  help: feather('help-circle'),
  time: feather('clock'),
  cash: material('cash-multiple'),
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof icons;

export interface IconProps {
  name: IconName;
  /** Token size, or an explicit pixel size when pairing with custom type. */
  size?: IconSizeToken | number;
  /** Semantic colour. Defaults to following the surrounding text. */
  tone?: TextTone;
  /** Explicit colour — for data-meaning colours only. */
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function Icon({ name, size = 'md', tone = 'secondary', color, style }: IconProps) {
  const theme = useTheme();
  const glyph: Glyph = icons[name];
  const resolvedSize = typeof size === 'number' ? size : iconSize[size];
  const resolvedColor = color ?? toneColor(theme, tone);

  switch (glyph.family) {
    case 'feather':
      return <Feather name={glyph.name} size={resolvedSize} color={resolvedColor} style={style} />;
    case 'ionicons':
      return <Ionicons name={glyph.name} size={resolvedSize} color={resolvedColor} style={style} />;
    case 'material':
      return (
        <MaterialCommunityIcons
          name={glyph.name}
          size={resolvedSize}
          color={resolvedColor}
          style={style}
        />
      );
  }
}
