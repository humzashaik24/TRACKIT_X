/**
 * Trackit X — MobileDrawer.
 *
 * The mobile form of the sidebar: a modal that slides in from the left, above
 * everything, dismissible by backdrop tap or the system back gesture. It shares
 * the `Sidebar` content with the desktop rail, so the mobile drawer can never
 * list destinations the desktop sidebar does not — one table, two widths.
 */
import { useEffect, type ReactNode } from 'react';
import { Modal as RNModal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layers, motion, radius, useReducedMotion, useTheme } from '@/design-system';

import { useEscapeToClose } from './useEscapeToClose';

export interface MobileDrawerProps {
  onClose: () => void;
  children: ReactNode;
  /** Drawer width. Clamped to 84% of a phone's width. */
  width?: number;
}

export function MobileDrawer({ onClose, children, width = 316 }: MobileDrawerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEscapeToClose(onClose);

  useEffect(() => {
    progress.value = reduceMotion
      ? 1
      : withTiming(1, {
          duration: motion.duration.slow,
          easing: Easing.bezier(...motion.curve.entrance),
        });
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * -width }],
  }));

  return (
    <RNModal
      transparent
      visible
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close navigation"
          accessibilityRole="button"
        />
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width,
              maxWidth: '84%',
              backgroundColor: theme.colors.surface,
              borderTopRightRadius: radius.xl,
              borderBottomRightRadius: radius.xl,
              borderRightWidth: 1,
              borderRightColor: theme.colors.border,
              zIndex: layers.drawer,
              paddingBottom: insets.bottom,
            },
            animatedStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});