/**
 * Trackit X — FilterBar.
 *
 * One row of controls above the content it filters, which is the only placement
 * that keeps cause and effect adjacent. On phones the chips scroll horizontally;
 * from tablet up they wrap, because a hidden filter is a filter users forget is
 * applied.
 *
 * Active filters are always visible as chips and always removable, and a
 * "Clear all" appears the moment more than one is on — the state is never
 * something the user has to reconstruct from memory.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type ViewStyle } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { controlHeight, radius, space } from '../tokens';
import { Button } from './Button';
import { HStack } from './Stack';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface FilterChipProps {
  label: string;
  active?: boolean;
  icon?: IconName;
  /** Matching-record count, shown as a trailing pill. */
  count?: number;
  onPress?: () => void;
  /** Renders an "×" instead of the count — for a removable applied filter. */
  onRemove?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}

export function FilterChip({
  label,
  active = false,
  icon,
  count,
  onPress,
  onRemove,
  disabled = false,
  style,
}: FilterChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onRemove ?? onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={onRemove === undefined ? label : `Remove filter ${label}`}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[1.5],
          height: controlHeight.sm,
          paddingHorizontal: space[3],
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: active ? theme.colors.accent.border : theme.colors.border,
          backgroundColor: active
            ? theme.colors.accent.subtle
            : pressed
              ? theme.colors.surfacePressed
              : theme.colors.surface,
          ...(disabled && { opacity: 0.5 }),
        },
        style,
      ]}
    >
      {icon !== undefined && <Icon name={icon} size="sm" tone={active ? 'accent' : 'tertiary'} />}
      {/* A check on an active chip: selection is never colour alone. */}
      {active && icon === undefined && <Icon name="check" size="sm" tone="accent" />}
      <Text variant="labelSm" tone={active ? 'accent' : 'secondary'} numberOfLines={1}>
        {label}
      </Text>
      {onRemove !== undefined ? (
        <Icon name="close" size="xs" tone={active ? 'accent' : 'tertiary'} />
      ) : (
        count !== undefined && (
          <View
            style={{
              paddingHorizontal: space[1.5],
              borderRadius: radius.pill,
              backgroundColor: active ? theme.colors.accent.border : theme.colors.neutral.subtle,
            }}
          >
            <Text variant="caption" tone={active ? 'accent' : 'tertiary'}>
              {count}
            </Text>
          </View>
        )
      )}
    </Pressable>
  );
}

export interface FilterOption {
  readonly key: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly count?: number;
}

export interface FilterBarProps {
  filters: readonly FilterOption[];
  activeKeys: readonly string[];
  onToggle: (key: string) => void;
  onClearAll?: () => void;
  /** Slot before the chips — a search field, a date-range control. */
  leading?: ReactNode;
  /** Slot after the chips — a sort control, a view switcher. */
  trailing?: ReactNode;
  /** Summary of what survived the filters, e.g. "128 of 340 tasks". */
  resultLabel?: string;
  style?: ViewStyle;
}

export function FilterBar({
  filters,
  activeKeys,
  onToggle,
  onClearAll,
  leading,
  trailing,
  resultLabel,
  style,
}: FilterBarProps) {
  const { isCompact } = useResponsive();
  const activeCount = activeKeys.length;

  const chips = filters.map((filter) => (
    <FilterChip
      key={filter.key}
      label={filter.label}
      icon={filter.icon}
      count={filter.count}
      active={activeKeys.includes(filter.key)}
      onPress={() => onToggle(filter.key)}
    />
  ));

  const clearAction = activeCount > 1 && onClearAll !== undefined && (
    <Button label="Clear all" variant="link" size="sm" iconLeft="close" onPress={onClearAll} />
  );

  return (
    <View style={[{ gap: space[3] }, style]}>
      {leading}

      {isCompact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space[2], paddingRight: space[4] }}
        >
          {chips}
          {clearAction}
        </ScrollView>
      ) : (
        <HStack gap={2} wrap justify="flex-start">
          {chips}
          {clearAction}
          {trailing !== undefined && <View style={{ flex: 1 }} />}
          {trailing}
        </HStack>
      )}

      {isCompact && trailing}

      {resultLabel !== undefined && (
        <Text variant="caption" tone="tertiary">
          {resultLabel}
        </Text>
      )}
    </View>
  );
}
