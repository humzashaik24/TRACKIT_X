/**
 * Trackit X — theme preferences.
 *
 * The one appearance preference the app has, as the option list both surfaces
 * (Settings "Preferences" and More "Appearance") render. It lives here rather
 * than in either screen so the two cannot drift apart.
 */
import type { SelectOption, ThemePreference } from '@/design-system';

export const THEME_OPTIONS: readonly SelectOption<ThemePreference>[] = [
  { value: 'dark', label: 'Dark', description: 'The default. Built for long sessions.', icon: 'theme' },
  { value: 'light', label: 'Light', description: 'For bright sites and daylight.', icon: 'theme' },
  {
    value: 'system',
    label: 'Match device',
    description: 'Follows your phone’s appearance setting.',
    icon: 'settings',
  },
];