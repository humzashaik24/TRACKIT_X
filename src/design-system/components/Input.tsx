/**
 * Trackit X — Input.
 *
 * A text field wrapped in the shared `FieldShell`. Two rules are enforced in code
 * rather than left to the caller:
 *
 *  · An error message replaces the helper text and recolours the border, so an
 *    invalid field is never signalled by colour alone.
 *  · A password field always offers a reveal toggle. Hiding a value the user is
 *    typing with no way to check it is the top cause of failed sign-ins.
 */
import { useCallback, useState } from 'react';
import { TextInput, type TextInputProps, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { controlHeight, radius, space, type ControlSize } from '../tokens';
import { FieldShell, hasFieldError, suppressWebOutline, useFieldBorder } from './Field';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

export interface InputProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label?: string;
  helperText?: string;
  error?: string;
  iconLeft?: IconName;
  /** Trailing icon. Ignored for password fields, which own that slot. */
  iconRight?: IconName;
  onPressIconRight?: () => void;
  size?: ControlSize;
  required?: boolean;
  /** Shows "n / maxLength" under the field. Requires `maxLength`. */
  showCounter?: boolean;
  containerStyle?: ViewStyle;
}

export function Input({
  label,
  helperText,
  error,
  iconLeft,
  iconRight,
  onPressIconRight,
  size = 'md',
  required = false,
  showCounter = false,
  secureTextEntry = false,
  editable = true,
  multiline = false,
  numberOfLines,
  maxLength,
  value,
  onFocus,
  onBlur,
  containerStyle,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const showError = hasFieldError(error);
  const borderStyle = useFieldBorder(focused, showError);

  const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    (event) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    (event) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const minHeight = multiline
    ? Math.max(controlHeight[size] * 2, (numberOfLines ?? 3) * 22 + space[4])
    : controlHeight[size];

  return (
    <FieldShell
      label={label}
      required={required}
      helperText={helperText}
      error={error}
      counter={
        showCounter && maxLength !== undefined ? `${value?.length ?? 0} / ${maxLength}` : undefined
      }
      style={containerStyle}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: multiline ? 'flex-start' : 'center',
            gap: space[2],
            minHeight,
            paddingHorizontal: space[3],
            paddingVertical: multiline ? space[3] : 0,
            borderRadius: radius.sm,
            borderWidth: 1,
            backgroundColor: editable ? theme.colors.surfaceInset : theme.colors.neutral.subtle,
            ...(!editable && { opacity: 0.7 }),
          },
          borderStyle,
        ]}
      >
        {iconLeft !== undefined && (
          <Icon
            name={iconLeft}
            size="md"
            tone={showError ? 'danger' : focused ? 'accent' : 'tertiary'}
            style={multiline ? { marginTop: 2 } : undefined}
          />
        )}

        <TextInput
          {...rest}
          value={value}
          editable={editable}
          multiline={multiline}
          maxLength={maxLength}
          secureTextEntry={secureTextEntry && !revealed}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholderTextColor={theme.colors.textTertiary}
          accessibilityLabel={label}
          accessibilityHint={showError ? error : helperText}
          accessibilityState={{ disabled: !editable }}
          style={[
            theme.typography.body,
            {
              flex: 1,
              color: theme.colors.text,
              paddingVertical: 0,
            },
            suppressWebOutline,
            multiline && {
              textAlignVertical: 'top' as const,
              minHeight: minHeight - space[6],
            },
          ]}
        />

        {secureTextEntry ? (
          <IconButton
            icon={revealed ? 'eyeOff' : 'eye'}
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            size="sm"
            onPress={() => setRevealed((current) => !current)}
          />
        ) : (
          iconRight !== undefined &&
          (onPressIconRight === undefined ? (
            <Icon name={iconRight} size="md" tone="tertiary" />
          ) : (
            <IconButton
              icon={iconRight}
              accessibilityLabel={label === undefined ? 'Field action' : `${label} action`}
              size="sm"
              onPress={onPressIconRight}
            />
          ))
        )}
      </Animated.View>
    </FieldShell>
  );
}
