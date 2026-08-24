/**
 * Trackit X — theme provider.
 *
 * Owns the active theme and the user's preference between dark, light and
 * "follow the system". The product is dark-first: `dark` is the default
 * preference, not `system`, so a first-run user sees the designed experience.
 *
 * Persistence is injected rather than imported. The design system must not
 * depend on application services (enforced by lint), so the host app passes a
 * storage adapter in; without one the preference lives for the session only.
 */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { themes, type Theme, type ThemeMode } from './theme';

/** What the user asked for, which is not the same as which theme is active. */
export type ThemePreference = ThemeMode | 'system';

/** Minimal async key/value contract, satisfied by AsyncStorage among others. */
export interface ThemeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ThemeContextValue {
  /** The resolved theme. Read tokens from here. */
  readonly theme: Theme;
  /** The resolved mode after applying `system`. */
  readonly mode: ThemeMode;
  /** What the user selected. */
  readonly preference: ThemePreference;
  /** True until a persisted preference has been read, if storage was provided. */
  readonly isHydrating: boolean;
  setPreference(preference: ThemePreference): void;
  /** Flips between dark and light, pinning the result (leaves `system`). */
  toggleMode(): void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'trackitx.theme.preference';
const DEFAULT_PREFERENCE: ThemePreference = 'dark';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Overrides the dark-first default. Useful in tests and storybook-style screens. */
  initialPreference?: ThemePreference;
  /** Optional persistence. Omit to keep the preference in memory. */
  storage?: ThemeStorage;
}

export function ThemeProvider({
  children,
  initialPreference = DEFAULT_PREFERENCE,
  storage,
}: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [isHydrating, setIsHydrating] = useState(storage !== undefined);

  useEffect(() => {
    if (!storage) return;
    let cancelled = false;
    void storage
      .getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isThemePreference(stored)) setPreferenceState(stored);
      })
      .catch(() => {
        // A failed read is not worth blocking the UI over — keep the default.
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      void storage?.setItem(STORAGE_KEY, next).catch(() => {
        // Preference is already applied in memory; persistence is best-effort.
      });
    },
    [storage],
  );

  // `system` resolves through the OS setting; anything else is explicit.
  const mode: ThemeMode =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const toggleMode = useCallback(() => {
    setPreference(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themes[mode],
      mode,
      preference,
      isHydrating,
      setPreference,
      toggleMode,
    }),
    [mode, preference, isHydrating, setPreference, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
