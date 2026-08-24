/**
 * Trackit X — Select.
 *
 * A single-choice dropdown. The list is a real anchored popover rather than a
 * centred dialog: it opens next to the control that owns it, flips above when
 * there is not enough room below, and clamps itself inside the window. On phones
 * that still reads correctly because the trigger is near the top of the sheet or
 * form it belongs to.
 *
 * Long option sets get a filter automatically — past roughly eight options,
 * scanning beats scrolling, and a select that cannot be searched is the reason
 * people give up on "assign to employee" pickers.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  TextInput,
  View,
  type ListRenderItemInfo,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { controlHeight, motion, radius, space, type ControlSize } from '../tokens';
import { FieldShell, hasFieldError, suppressWebOutline, useFieldBorder } from './Field';
import { HStack, VStack } from './Stack';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  /** Secondary line — a code, a department, a unit. */
  readonly description?: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  options: readonly SelectOption<T>[];
  value?: T | null;
  onChange: (value: T) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: string;
  size?: ControlSize;
  required?: boolean;
  disabled?: boolean;
  /** Force the filter on or off. Defaults to on past `searchThreshold`. */
  searchable?: boolean;
  searchThreshold?: number;
  /** Offers an "×" that clears the selection. */
  clearable?: boolean;
  onClear?: () => void;
  containerStyle?: ViewStyle;
  /** Overrides the accessibility label when there is no visible `label`. */
  accessibilityLabel?: string;
}

interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LIST_MAX_HEIGHT = 296;
const ROW_MIN_HEIGHT = 44;
const EDGE_INSET = 12;

export function Select<T extends string = string>({
  options,
  value = null,
  onChange,
  label,
  placeholder = 'Select…',
  helperText,
  error,
  size = 'md',
  required = false,
  disabled = false,
  searchable,
  searchThreshold = 8,
  clearable = false,
  onClear,
  containerStyle,
  accessibilityLabel,
}: SelectProps<T>) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useResponsive();
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [query, setQuery] = useState('');

  const showError = hasFieldError(error);
  const borderStyle = useFieldBorder(open, showError);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const isSearchable = searchable ?? options.length > searchThreshold;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length === 0) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        (option.description?.toLowerCase().includes(term) ?? false),
    );
  }, [options, query]);

  const openList = useCallback(() => {
    if (disabled) return;
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  }, [disabled]);

  const closeList = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const handleSelect = useCallback(
    (option: SelectOption<T>) => {
      if (option.disabled === true) return;
      onChange(option.value);
      closeList();
    },
    [closeList, onChange],
  );

  // Placement: prefer below, flip above when the list would be clipped.
  const spaceBelow = anchor === null ? 0 : windowHeight - (anchor.y + anchor.height);
  const spaceAbove = anchor?.y ?? 0;
  const openUp = anchor !== null && spaceBelow < LIST_MAX_HEIGHT + EDGE_INSET && spaceAbove > spaceBelow;
  const availableHeight = Math.max(
    ROW_MIN_HEIGHT * 2,
    (openUp ? spaceAbove : spaceBelow) - EDGE_INSET * 2,
  );
  const popoverWidth =
    anchor === null
      ? 0
      : Math.min(Math.max(anchor.width, 248), windowWidth - EDGE_INSET * 2);
  const popoverLeft =
    anchor === null
      ? 0
      : Math.max(EDGE_INSET, Math.min(anchor.x, windowWidth - popoverWidth - EDGE_INSET));

  return (
    <FieldShell
      label={label}
      required={required}
      helperText={helperText}
      error={error}
      style={containerStyle}
    >
      <Pressable
        ref={triggerRef}
        onPress={openList}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label ?? 'Select an option'}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityState={{ disabled, expanded: open }}
      >
        <Animated.View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              minHeight: controlHeight[size],
              paddingHorizontal: space[3],
              borderRadius: radius.sm,
              borderWidth: 1,
              backgroundColor: disabled
                ? theme.colors.neutral.subtle
                : theme.colors.surfaceInset,
              ...(disabled && { opacity: 0.7 }),
            },
            borderStyle,
          ]}
        >
          {selected?.icon !== undefined && (
            <Icon name={selected.icon} size="md" tone="secondary" />
          )}
          <Text
            variant="body"
            tone={selected === null ? 'tertiary' : 'primary'}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {selected?.label ?? placeholder}
          </Text>
          {clearable && selected !== null && !disabled && (
            <IconButton
              icon="close"
              accessibilityLabel={`Clear ${label ?? 'selection'}`}
              size="xs"
              onPress={onClear}
            />
          )}
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size="md" tone="tertiary" />
        </Animated.View>
      </Pressable>

      {open && anchor !== null && (
        <Modal
          transparent
          visible
          animationType="none"
          onRequestClose={closeList}
          statusBarTranslucent
        >
          {/* Backdrop: dismisses, and is invisible to assistive tech so the list
              is the only thing announced. */}
          <Pressable
            accessibilityLabel="Close options"
            accessibilityRole="button"
            onPress={closeList}
            style={{ flex: 1 }}
          >
            <View style={{ flex: 1 }} />
          </Pressable>

          <SelectPopover
            style={{
              position: 'absolute',
              left: popoverLeft,
              width: popoverWidth,
              maxHeight: Math.min(LIST_MAX_HEIGHT, availableHeight),
              ...(openUp
                ? { bottom: windowHeight - anchor.y + space[1.5] }
                : { top: anchor.y + anchor.height + space[1.5] }),
            }}
            openUp={openUp}
          >
            {isSearchable && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[2],
                  paddingHorizontal: space[3],
                  height: controlHeight.md,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.borderSubtle,
                }}
              >
                <Icon name="search" size="sm" tone="tertiary" />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Filter options"
                  placeholderTextColor={theme.colors.textTertiary}
                  autoFocus
                  accessibilityLabel="Filter options"
                  style={[
                    theme.typography.body,
                    { flex: 1, color: theme.colors.text, paddingVertical: 0 },
                    suppressWebOutline,
                  ]}
                />
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(option) => option.value}
              keyboardShouldPersistTaps="handled"
              accessibilityRole="menu"
              ListEmptyComponent={
                <View style={{ padding: space[4] }}>
                  <Text variant="bodySm" tone="tertiary">
                    No matching options
                  </Text>
                </View>
              }
              renderItem={({ item }: ListRenderItemInfo<SelectOption<T>>) => (
                <SelectRow
                  option={item}
                  selected={item.value === value}
                  onPress={() => handleSelect(item)}
                />
              )}
            />
          </SelectPopover>
        </Modal>
      )}
    </FieldShell>
  );
}

/** The floating panel, with its own entry animation. */
function SelectPopover({
  style,
  openUp,
  children,
}: {
  style: ViewStyle;
  openUp: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? 1
      : withTiming(1, {
          duration: motion.duration.base,
          easing: Easing.bezier(...motion.curve.entrance),
        });
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Grows out of the trigger: downward lists rise, upward lists drop.
    transform: [{ translateY: (1 - progress.value) * (openUp ? 8 : -8) }],
  }));

  return (
    <Animated.View
      style={[
        {
          overflow: 'hidden',
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceOverlay,
          ...theme.shadows.lg,
        },
        style,
        animatedStyle,
      ]}
    >
      {children}
    </Animated.View>
  );
}

function SelectRow<T extends string>({
  option,
  selected,
  onPress,
}: {
  option: SelectOption<T>;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const isDisabled = option.disabled === true;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="menuitem"
      accessibilityLabel={option.label}
      accessibilityHint={option.description}
      accessibilityState={{ selected, disabled: isDisabled }}
      style={({ pressed }) => ({
        minHeight: ROW_MIN_HEIGHT,
        paddingHorizontal: space[3],
        paddingVertical: space[2],
        justifyContent: 'center',
        backgroundColor: pressed
          ? theme.colors.surfacePressed
          : selected
            ? theme.colors.accent.subtle
            : 'transparent',
        ...(isDisabled && { opacity: 0.45 }),
      })}
    >
      <HStack gap={2.5}>
        {option.icon !== undefined && (
          <Icon name={option.icon} size="md" tone={selected ? 'accent' : 'secondary'} />
        )}
        <VStack flex={1} gap={0}>
          <Text variant="body" tone={selected ? 'accent' : 'primary'} numberOfLines={1}>
            {option.label}
          </Text>
          {option.description !== undefined && (
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {option.description}
            </Text>
          )}
        </VStack>
        {/* A checkmark, not just a tint — selection is never colour alone. */}
        {selected && <Icon name="check" size="md" tone="accent" />}
      </HStack>
    </Pressable>
  );
}
