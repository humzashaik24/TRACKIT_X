/**
 * Trackit X — SearchBar.
 *
 * A page-level search control, separate from `Input` because its behaviour is
 * different: it debounces, it exposes a clear affordance as soon as there is
 * something to clear, and it reports "searching" without blocking typing.
 *
 * The debounce fires `onSearch`, never `onChangeText` — the field stays fully
 * controlled and responsive while the expensive query is the one that waits.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, TextInput, View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { controlHeight, radius, space, type ControlSize } from '../tokens';
import { suppressWebOutline, useFieldBorder } from './Field';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export interface SearchBarProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Fired once typing settles. Wire the query here, not to `onChangeText`. */
  onSearch?: (value: string) => void;
  debounceMs?: number;
  placeholder?: string;
  /** Shows a spinner in place of the search glyph. */
  loading?: boolean;
  autoFocus?: boolean;
  size?: ControlSize;
  /** Right-hand slot — a filter button, a view switcher. */
  trailing?: ReactNode;
  onSubmit?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function SearchBar({
  value,
  onChangeText,
  onSearch,
  debounceMs = 260,
  placeholder = 'Search',
  loading = false,
  autoFocus = false,
  size = 'md',
  trailing,
  onSubmit,
  accessibilityLabel = 'Search',
  style,
}: SearchBarProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderStyle = useFieldBorder(focused, false);

  // Seeded with the initial value so mounting does not fire a redundant query.
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (onSearch === undefined) return;
    if (value === lastEmitted.current) return;
    const timer = setTimeout(() => {
      lastEmitted.current = value;
      onSearch(value);
    }, debounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [debounceMs, onSearch, value]);

  const clear = useCallback(() => {
    onChangeText('');
    // Clearing is an explicit intent — it should not wait out the debounce.
    lastEmitted.current = '';
    onSearch?.('');
  }, [onChangeText, onSearch]);

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          height: controlHeight[size],
          paddingHorizontal: space[3],
          borderRadius: radius.pill,
          borderWidth: 1,
          backgroundColor: theme.colors.surfaceInset,
        },
        borderStyle,
        style,
      ]}
    >
      {loading ? (
        <View style={{ width: theme.iconSize.md, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={theme.colors.textTertiary} />
        </View>
      ) : (
        <Icon name="search" size="md" tone={focused ? 'accent' : 'tertiary'} />
      )}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel}
        style={[
          theme.typography.body,
          { flex: 1, color: theme.colors.text, paddingVertical: 0 },
          suppressWebOutline,
        ]}
      />

      {value.length > 0 && (
        <IconButton icon="close" accessibilityLabel="Clear search" size="xs" onPress={clear} />
      )}
      {trailing}
    </Animated.View>
  );
}
