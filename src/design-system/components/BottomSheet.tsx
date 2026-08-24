/**
 * Trackit X — BottomSheet.
 *
 * The phone-native surface for secondary flows: filters, record detail, quick
 * actions. It is a distinct component from `Modal` rather than a variant because
 * it has a behaviour `Modal` does not — you can drag it away. That gesture is the
 * whole point on touch, and it needs a grabber, a rubber-band, and a
 * velocity-aware dismiss threshold to feel like the platform.
 *
 * Multi-detent snapping (half → full) is deliberately NOT implemented: a
 * half-working snap feels broken. The sheet sizes to its content up to
 * `maxHeightRatio` and can be dragged down to dismiss.
 *
 * Requires the app to be wrapped in `GestureHandlerRootView` — Expo Router's root
 * layout does that once for the whole product.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal as RNModal, Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { motion, radius, space } from '../tokens';
import { Divider } from './Divider';
import { HStack, VStack } from './Stack';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  /** Fraction of window height the sheet may occupy. */
  maxHeightRatio?: number;
  dismissOnBackdrop?: boolean;
  /** Draws the drag grabber. Turn off only for a sheet that must not be dragged. */
  showHandle?: boolean;
  showClose?: boolean;
  footer?: ReactNode;
  scrollable?: boolean;
  children?: ReactNode;
  contentStyle?: ViewStyle;
}

/** Drag distance past which release dismisses instead of springing back. */
const DISMISS_DISTANCE = 120;
/** Downward velocity (px/s) that dismisses regardless of distance. */
const DISMISS_VELOCITY = 900;

export function BottomSheet({
  visible,
  onClose,
  title,
  description,
  maxHeightRatio = 0.9,
  dismissOnBackdrop = true,
  showHandle = true,
  showClose = false,
  footer,
  scrollable = true,
  children,
  contentStyle,
}: BottomSheetProps) {
  const [rendered, setRendered] = useState(visible);

  // Derived from a prop and adjusted during render, not in an effect: opening has
  // to mount the surface in the SAME commit that flips `visible`, or the entrance
  // animation starts a frame late and the sheet appears to jump. React sanctions
  // adjusting state during render for exactly this case.
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
      <SheetSurface
        open={visible}
        onClosed={handleClosed}
        onClose={onClose}
        title={title}
        description={description}
        maxHeightRatio={maxHeightRatio}
        dismissOnBackdrop={dismissOnBackdrop}
        showHandle={showHandle}
        showClose={showClose}
        footer={footer}
        scrollable={scrollable}
        contentStyle={contentStyle}
      >
        {children}
      </SheetSurface>
    </RNModal>
  );
}

interface SheetSurfaceProps extends Omit<BottomSheetProps, 'visible'> {
  open: boolean;
  onClosed: () => void;
}

function SheetSurface({
  open,
  onClosed,
  onClose,
  title,
  description,
  maxHeightRatio = 0.9,
  dismissOnBackdrop = true,
  showHandle = true,
  showClose = false,
  footer,
  scrollable = true,
  children,
  contentStyle,
}: SheetSurfaceProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useResponsive();

  const [sheetHeight, setSheetHeight] = useState(0);
  /** 0 = fully off-screen, 1 = seated. */
  const entered = useSharedValue(0);
  /** Live drag offset in px, always ≥ 0. */
  const drag = useSharedValue(0);
  /** Measured travel distance, so the sheet enters from exactly its own height. */
  const travel = useSharedValue(0);
  /** Suppresses the first frame until the height is known. */
  const ready = useSharedValue(0);

  useEffect(() => {
    if (sheetHeight === 0) return;
    travel.value = sheetHeight;
    ready.value = 1;
    if (open) {
      entered.value = reduceMotion ? 1 : withSpring(1, motion.spring.sheet);
    }
  }, [entered, open, ready, reduceMotion, sheetHeight, travel]);

  useEffect(() => {
    if (open) return;
    if (reduceMotion) {
      onClosed();
      return;
    }
    entered.value = withTiming(
      0,
      { duration: motion.duration.base, easing: Easing.bezier(...motion.curve.exit) },
      (finished) => {
        if (finished === true) runOnJS(onClosed)();
      },
    );
  }, [entered, onClosed, open, reduceMotion]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Downward only. Upward drag would detach the sheet from its edge.
      drag.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      const shouldDismiss =
        event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY;
      if (shouldDismiss) {
        runOnJS(onClose)();
        return;
      }
      drag.value = withSpring(0, motion.spring.sheet);
    });

  const scrimStyle = useAnimatedStyle(() => ({
    // Fades with the drag too, so pulling down previews the dismissal.
    opacity:
      entered.value * (travel.value === 0 ? 1 : Math.max(0, 1 - drag.value / travel.value)),
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: ready.value,
    transform: [{ translateY: (1 - entered.value) * travel.value + drag.value }],
  }));

  const maxHeight = windowHeight * maxHeightRatio - insets.top;

  const body = (
    <View style={[{ paddingHorizontal: space[5], paddingVertical: space[4] }, contentStyle]}>
      {children}
    </View>
  );

  const header = (
    <VStack gap={0}>
      {showHandle && (
        <View style={{ alignItems: 'center', paddingTop: space[2.5], paddingBottom: space[1] }}>
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: theme.colors.borderStrong,
            }}
          />
        </View>
      )}
      {(title !== undefined || showClose) && (
        <>
          <HStack
            gap={3}
            align="flex-start"
            style={{ paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[4] }}
          >
            <VStack gap={1} flex={1}>
              {title !== undefined && <Text variant="h3">{title}</Text>}
              {description !== undefined && (
                <Text variant="bodySm" tone="secondary">
                  {description}
                </Text>
              )}
            </VStack>
            {showClose && (
              <IconButton
                icon="close"
                accessibilityLabel="Close sheet"
                size="sm"
                onPress={onClose}
              />
            )}
          </HStack>
          <Divider subtle />
        </>
      )}
    </VStack>
  );

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.colors.scrim,
          },
          scrimStyle,
        ]}
      >
        <Pressable
          onPress={dismissOnBackdrop ? onClose : undefined}
          disabled={!dismissOnBackdrop}
          accessibilityLabel="Dismiss sheet"
          accessibilityRole="button"
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        accessibilityLabel={title}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
        style={[
          {
            maxHeight,
            backgroundColor: theme.colors.surfaceOverlay,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            borderTopLeftRadius: radius['2xl'],
            borderTopRightRadius: radius['2xl'],
            overflow: 'hidden',
            ...theme.shadows.xl,
          },
          sheetStyle,
        ]}
      >
        {/* Only the header is a drag handle — a body-wide gesture would fight
            the scroll view inside it. */}
        <GestureDetector gesture={panGesture}>{header}</GestureDetector>

        {scrollable ? (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {body}
          </ScrollView>
        ) : (
          body
        )}

        {footer !== undefined && (
          <>
            <Divider subtle />
            <View style={{ padding: space[5], paddingBottom: space[5] + insets.bottom }}>
              {footer}
            </View>
          </>
        )}
        {footer === undefined && <View style={{ height: insets.bottom + space[2] }} />}
      </Animated.View>
    </View>
  );
}
