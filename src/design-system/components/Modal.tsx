/**
 * Trackit X — Modal.
 *
 * One dialog component with two presentations, chosen by density rather than by
 * the caller: a centred panel from tablet up, and a bottom-anchored sheet on
 * phones. That is not decoration — a centred dialog on a phone puts its actions
 * out of thumb reach and fights the keyboard.
 *
 * Dismissal is deliberate: `dismissOnBackdrop` defaults to on for informational
 * dialogs, and callers turn it off for destructive confirmations so a stray tap
 * cannot resolve a decision that matters.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { motion, radius, space } from '../tokens';
import { Divider } from './Divider';
import { HStack, VStack } from './Stack';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ModalIntent = 'neutral' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'info';

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** One line under the title. Longer explanations belong in the body. */
  description?: string;
  size?: ModalSize;
  /** Off for destructive confirmations — a stray tap must not decide. */
  dismissOnBackdrop?: boolean;
  showClose?: boolean;
  /** Action row, pinned below the scrolling body. */
  footer?: ReactNode;
  /** Wraps the body in a ScrollView. On by default. */
  scrollable?: boolean;
  /** Tints the header icon and title accent. */
  intent?: ModalIntent;
  icon?: IconName;
  children?: ReactNode;
  contentStyle?: ViewStyle;
}

/** Maximum panel width per size, before window clamping. */
const panelWidth: Record<Exclude<ModalSize, 'full'>, number> = {
  sm: 420,
  md: 560,
  lg: 760,
  xl: 980,
};

const EDGE_INSET = 24;

export function Modal({
  visible,
  onClose,
  title,
  description,
  size = 'md',
  dismissOnBackdrop = true,
  showClose = true,
  footer,
  scrollable = true,
  intent = 'neutral',
  icon,
  children,
  contentStyle,
}: ModalProps) {
  // The dialog stays mounted through its exit animation, then unmounts.
  const [rendered, setRendered] = useState(visible);

  // Derived from a prop and adjusted during render, not in an effect: opening has
  // to mount the dialog in the SAME commit that flips `visible`, or the entrance
  // animation starts a frame late. React sanctions adjusting state during render
  // for exactly this case.
  if (visible && !rendered) setRendered(true);

  const handleClosed = useCallback(() => setRendered(false), []);

  if (!rendered) return null;

  return (
    <RNModal
      transparent
      visible
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <ModalSurface
        open={visible}
        onClosed={handleClosed}
        onClose={onClose}
        title={title}
        description={description}
        size={size}
        dismissOnBackdrop={dismissOnBackdrop}
        showClose={showClose}
        footer={footer}
        scrollable={scrollable}
        intent={intent}
        icon={icon}
        contentStyle={contentStyle}
      >
        {children}
      </ModalSurface>
    </RNModal>
  );
}

interface ModalSurfaceProps extends Omit<ModalProps, 'visible'> {
  open: boolean;
  onClosed: () => void;
}

function ModalSurface({
  open,
  onClosed,
  onClose,
  title,
  description,
  size = 'md',
  dismissOnBackdrop = true,
  showClose = true,
  footer,
  scrollable = true,
  intent = 'neutral',
  icon,
  children,
  contentStyle,
}: ModalSurfaceProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { isCompact, width: windowWidth, height: windowHeight } = useResponsive();
  const progress = useSharedValue(0);

  useEffect(() => {
    const target = open ? 1 : 0;
    if (reduceMotion) {
      progress.value = target;
      if (!open) onClosed();
      return;
    }
    progress.value = withTiming(
      target,
      {
        duration: open ? motion.duration.slow : motion.duration.base,
        easing: Easing.bezier(...(open ? motion.curve.entrance : motion.curve.exit)),
      },
      (finished) => {
        if (finished === true && target === 0) {
          runOnJS(onClosed)();
        }
      },
    );
  }, [onClosed, open, progress, reduceMotion]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: isCompact
      ? // Phones: the sheet rises from the bottom edge it is anchored to.
        [{ translateY: (1 - progress.value) * 56 }]
      : // Tablet and up: a slight scale-in reads as "this came forward".
        [{ scale: 0.965 + progress.value * 0.035 }],
  }));

  const maxWidth =
    size === 'full'
      ? windowWidth - EDGE_INSET * 2
      : Math.min(panelWidth[size], windowWidth - EDGE_INSET * 2);

  const maxHeight = isCompact
    ? windowHeight * 0.92 - insets.top
    : Math.min(windowHeight - EDGE_INSET * 2, size === 'full' ? Number.MAX_SAFE_INTEGER : 760);

  const intentColors = theme.colors[intent];
  const headerIcon = icon;

  const body = (
    <View style={[{ paddingHorizontal: space[5], paddingVertical: space[4] }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, justifyContent: isCompact ? 'flex-end' : 'center', alignItems: 'center' }}>
      <Animated.View
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.scrim },
          scrimStyle,
        ]}
      >
        <Pressable
          onPress={dismissOnBackdrop ? onClose : undefined}
          disabled={!dismissOnBackdrop}
          accessibilityLabel="Dismiss dialog"
          accessibilityRole="button"
          style={{ flex: 1 }}
        />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ width: '100%', alignItems: 'center' }}
        pointerEvents="box-none"
      >
        <Animated.View
          accessibilityRole="alert"
          accessibilityLabel={title}
          style={[
            {
              width: isCompact ? '100%' : maxWidth,
              maxWidth: isCompact ? undefined : maxWidth,
              maxHeight,
              backgroundColor: theme.colors.surfaceOverlay,
              borderWidth: 1,
              borderColor: theme.colors.border,
              // A phone sheet keeps square bottom corners: it is attached to the
              // edge of the screen, not floating above it.
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderBottomLeftRadius: isCompact ? 0 : radius.xl,
              borderBottomRightRadius: isCompact ? 0 : radius.xl,
              overflow: 'hidden',
              ...theme.shadows.xl,
            },
            panelStyle,
          ]}
        >
          {(title !== undefined || showClose) && (
            <>
              <HStack gap={3} align="flex-start" style={{ padding: space[5], paddingBottom: space[4] }}>
                {headerIcon !== undefined && (
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: intentColors.subtle,
                      borderWidth: 1,
                      borderColor: intentColors.border,
                    }}
                  >
                    <Icon
                      name={headerIcon}
                      size="lg"
                      tone={
                        intent === 'neutral' ? 'secondary' : intent === 'accent' ? 'accent' : intent
                      }
                    />
                  </View>
                )}
                <VStack gap={1} flex={1}>
                  {title !== undefined && (
                    <Text variant={isCompact ? 'h3' : 'h2'}>{title}</Text>
                  )}
                  {description !== undefined && (
                    <Text variant="bodySm" tone="secondary">
                      {description}
                    </Text>
                  )}
                </VStack>
                {showClose && (
                  <IconButton
                    icon="close"
                    accessibilityLabel="Close dialog"
                    size="sm"
                    onPress={onClose}
                  />
                )}
              </HStack>
              <Divider subtle />
            </>
          )}

          {scrollable ? (
            <ScrollView
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {body}
            </ScrollView>
          ) : (
            body
          )}

          {footer !== undefined && (
            <>
              <Divider subtle />
              <View
                style={{
                  padding: space[5],
                  paddingBottom: isCompact ? space[5] + insets.bottom : space[5],
                }}
              >
                {footer}
              </View>
            </>
          )}
          {footer === undefined && isCompact && <View style={{ height: insets.bottom }} />}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
