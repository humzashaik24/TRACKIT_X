/**
 * Trackit X — themed stylesheet hook.
 *
 * Style factories are declared at module scope and receive the theme, so the
 * resulting `StyleSheet` is created once per theme rather than on every render:
 *
 *   const styles = createStyles((theme) => ({
 *     card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg },
 *   }));
 *
 *   function Card() {
 *     const s = useStyles(styles);
 *     ...
 *   }
 *
 * Declaring the factory inline inside a component defeats the memoisation, so
 * don't — that is the whole reason `createStyles` exists as a named step.
 */
import { useMemo } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import type { Theme } from '../theme/theme';
import { useTheme } from './useTheme';

type Style = ViewStyle | TextStyle | ImageStyle;
export type StyleMap = Record<string, Style>;
export type StyleFactory<T extends StyleMap> = (theme: Theme) => T;

/** Identity function that pins the theme parameter's type. */
export function createStyles<T extends StyleMap>(factory: StyleFactory<T>): StyleFactory<T> {
  return factory;
}

export function useStyles<T extends StyleMap>(factory: StyleFactory<T>): T {
  const theme = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme)), [factory, theme]);
}
