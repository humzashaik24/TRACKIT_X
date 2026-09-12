/**
 * Trackit X — header popover.
 *
 * The dropdown panel shared by the header's menus (notifications, organization
 * switcher, user profile). One presentation for all of them keeps the three
 * menus consistent: a right-anchored panel below the header on wide screens, a
 * bottom sheet on phones.
 *
 * Implemented as a modal rather than an absolutely-positioned view so it sits
 * above anything the content area might layer (sticky headers, cards), and so
 * the backdrop tap-away works on native as well as on the web.
 */
import { useEffect, type ReactNode } from 'react';
import {
  Modal as RNModal,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layers, layout, motion, radius, space, useReducedMotion, useResponsive, useTheme } from '@/design-system';

import { useEscapeToClose } from './useEscapeToClose';

export interface HeaderPopoverProps {
  onClose: () => void;
  /** Panel width on wide screens. */
  width?: number;
  children: ReactNode;
}

export function HeaderPopover({ onClose, width = 340, children }: HeaderPopoverProps) {
  const theme = useTheme();
  const { isCompact, height } = useResponsive();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEscapeToClose(onClose);

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
    transform: [{ translateY: (1 - progress.value) * (isCompact ? 24 : -8) }],
  }));

  const maxHeight = Math.min(height * 0.8, 560);

  const panelStyle: ViewStyle = isCompact
    ? {
        width: '100%',
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        maxHeight,
        paddingBottom: insets.bottom,
      }
    : {
        position: 'absolute',
        top: insets.top + layout.topBarHeight + space[3],
        right: Math.max(insets.right, space[5]),
        width,
        maxHeight,
        borderRadius: radius.xl,
      };

  return (
    <RNModal
      transparent
      visible
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View
        style={[
          styles.root,
          {
            justifyContent: isCompact ? 'flex-end' : 'flex-start',
            zIndex: layers.modal,
          },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close panel"
          accessibilityRole="button"
        />
        <Animated.View
          style={[
            {
              backgroundColor: theme.colors.surfaceOverlay,
              borderWidth: 1,
              borderColor: theme.colors.border,
              ...theme.shadows.lg,
              overflow: 'hidden',
            },
            panelStyle,
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