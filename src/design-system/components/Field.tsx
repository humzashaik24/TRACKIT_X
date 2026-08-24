/**
 * Trackit X — field shell.
 *
 * Every form control in the product wears the same chrome: a label with an
 * optional required marker, the control itself, and a footer that shows *either*
 * a helper message or a validation error, plus an optional right-aligned counter.
 *
 * This lives in one place because the alternative — each control assembling its
 * own label and error row — is how design systems end up with three slightly
 * different error treatments. `Input` and `Select` both render through it.
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';
import {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useTheme } from '../hooks/useTheme';
import { motion } from '../tokens';
import { HStack, VStack } from './Stack';
import { Icon } from './Icon';
import { Text } from './Text';

export interface FieldShellProps {
  label?: string;
  required?: boolean;
  /** Guidance under the control. Replaced by `error` when one is present. */
  helperText?: string;
  /** Validation message. Its presence puts the field in the error state. */
  error?: string;
  /** Right-aligned footer text, e.g. "18 / 120". */
  counter?: string;
  children: ReactNode;
  style?: ViewStyle;
}

/** True when the error string carries an actual message. */
export function hasFieldError(error: string | undefined): boolean {
  return error !== undefined && error.length > 0;
}

/**
 * Suppresses the browser's default focus ring on React Native Web inputs. Our
 * focus indicator is the animated border below, which is theme-aware; the two
 * drawn together read as a double outline. `outlineStyle` is a web-only style
 * key, hence the cast.
 *
 * This is not "removing the focus indicator" — the field still has a visible,
 * contrast-checked focus state. Removing it outright would break keyboard use.
 */
export const suppressWebOutline = { outlineStyle: 'none' } as unknown as TextStyle;

export function FieldShell({
  label,
  required = false,
  helperText,
  error,
  counter,
  children,
  style,
}: FieldShellProps) {
  const showError = hasFieldError(error);
  const showFooter = showError || helperText !== undefined || counter !== undefined;

  return (
    <VStack gap={1.5} style={style}>
      {label !== undefined && (
        <HStack gap={1}>
          <Text variant="label" tone="secondary">
            {label}
          </Text>
          {required && (
            <Text variant="label" tone="danger" accessibilityLabel="required">
              *
            </Text>
          )}
        </HStack>
      )}

      {children}

      {showFooter && (
        <HStack gap={2} align="flex-start">
          <View style={{ flex: 1 }}>
            {showError ? (
              <HStack gap={1} align="flex-start">
                {/* An icon beside the message: an error is never colour alone. */}
                <Icon name="warning" size="xs" tone="danger" style={{ marginTop: 2 }} />
                <Text variant="caption" tone="danger" style={{ flex: 1 }}>
                  {error}
                </Text>
              </HStack>
            ) : (
              helperText !== undefined && (
                <Text variant="caption" tone="tertiary">
                  {helperText}
                </Text>
              )
            )}
          </View>
          {counter !== undefined && (
            <Text variant="caption" tone="tertiary">
              {counter}
            </Text>
          )}
        </HStack>
      )}
    </VStack>
  );
}

/**
 * The animated border every field uses to show focus. Errors shift both the rest
 * and active colours to the danger ramp, so an invalid field reads as invalid
 * whether or not it currently has focus.
 */
export function useFieldBorder(active: boolean, hasError: boolean): AnimatedStyle<ViewStyle> {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(active ? 1 : 0);

  const restColor = hasError ? theme.colors.danger.border : theme.colors.border;
  const activeColor = hasError ? theme.colors.danger.fg : theme.colors.borderFocus;

  useEffect(() => {
    const target = active ? 1 : 0;
    progress.value = reduceMotion
      ? target
      : withTiming(target, {
          duration: motion.duration.fast,
          easing: Easing.bezier(...motion.curve.standard),
        });
  }, [active, progress, reduceMotion]);

  return useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [restColor, activeColor]),
  }));
}
