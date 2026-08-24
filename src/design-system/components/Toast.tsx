/**
 * Trackit X — Toast.
 *
 * Transient confirmations and failures. Three rules are baked in:
 *
 *  · Failures do not auto-dismiss. A message the user may need to act on must not
 *    disappear while they are reading it, so `danger` toasts stay until dismissed.
 *  · At most three are visible; a fourth retires the oldest. A stack that grows
 *    without bound covers the content it is reporting on.
 *  · Every toast carries an icon and a label, never colour alone, and is
 *    announced to assistive technology as a live region.
 *
 * Placement follows density: bottom-centre on phones (thumb reach, above the tab
 * bar), top-right on desktop where it does not cover the primary work area.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { layers, layout, motion, radius, space } from '../tokens';
import { Button } from './Button';
import { HStack, VStack } from './Stack';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

export type ToastIntent = 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'neutral';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  title: string;
  /** Detail line. Keep it to one sentence — this is not an error report. */
  message?: string;
  intent?: ToastIntent;
  /** Milliseconds on screen. `0` keeps it until dismissed. */
  duration?: number;
  action?: ToastAction;
}

export interface ToastController {
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

const ToastContext = createContext<ToastController | null>(null);

/** How long each intent stays, in ms. Failures are sticky by design. */
const defaultDuration: Record<ToastIntent, number> = {
  success: 3600,
  info: 4200,
  ai: 4800,
  warning: 6000,
  danger: 0,
  neutral: 4200,
};

const intentIcon: Record<ToastIntent, IconName> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  ai: 'aiSpark',
  neutral: 'notifications',
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => setToasts([]), []);

  const show = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    const id = `toast-${nextId.current}`;
    setToasts((current) => {
      const next = [...current, { ...options, id }];
      // Retire the oldest rather than letting the stack cover the screen.
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
    return id;
  }, []);

  const controller = useMemo<ToastController>(
    () => ({ show, dismiss, dismissAll }),
    [dismiss, dismissAll, show],
  );

  return (
    <ToastContext.Provider value={controller}>
      <View style={{ flex: 1 }}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastController {
  const controller = useContext(ToastContext);
  if (controller === null) {
    throw new Error('useToast must be used inside a <ToastProvider>.');
  }
  return controller;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { isCompact } = useResponsive();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        zIndex: layers.toast,
        gap: space[2],
        ...(isCompact
          ? {
              left: space[4],
              right: space[4],
              // Clears the tab bar so a confirmation never hides navigation.
              bottom: insets.bottom + layout.tabBarHeight + space[3],
            }
          : {
              top: insets.top + space[4],
              right: space[6],
              width: 380,
            }),
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} fromBottom={isCompact} />
      ))}
    </View>
  );
}

function ToastItem({
  toast,
  onDismiss,
  fromBottom,
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
  fromBottom: boolean;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  const intent = toast.intent ?? 'neutral';
  const colors = theme.colors[intent];
  const duration = toast.duration ?? defaultDuration[intent];

  useEffect(() => {
    progress.value = reduceMotion
      ? 1
      : withTiming(1, {
          duration: motion.duration.base,
          easing: Easing.bezier(...motion.curve.entrance),
        });
  }, [progress, reduceMotion]);

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, onDismiss, toast.id]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * (fromBottom ? 16 : -16) }],
  }));

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space[3],
          padding: space[3.5],
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: intent === 'neutral' ? theme.colors.border : colors.border,
          backgroundColor: theme.colors.surfaceOverlay,
          ...theme.shadows.lg,
        },
        animatedStyle,
      ]}
    >
      {/* Coloured edge plus icon: the intent is legible without relying on hue. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          borderTopLeftRadius: radius.md,
          borderBottomLeftRadius: radius.md,
          backgroundColor: intent === 'neutral' ? theme.colors.borderStrong : colors.fg,
        }}
      />
      <Icon
        name={intentIcon[intent]}
        size="lg"
        tone={intent === 'neutral' ? 'secondary' : intent}
      />
      <VStack gap={1} flex={1}>
        <Text variant="h4">{toast.title}</Text>
        {toast.message !== undefined && (
          <Text variant="bodySm" tone="secondary">
            {toast.message}
          </Text>
        )}
        {toast.action !== undefined && (
          <HStack gap={2} style={{ marginTop: space[1] }}>
            <Button
              label={toast.action.label}
              variant="link"
              size="sm"
              intent={intent === 'neutral' ? 'accent' : intent === 'ai' ? 'ai' : 'accent'}
              onPress={toast.action.onPress}
            />
          </HStack>
        )}
      </VStack>
      <IconButton
        icon="close"
        accessibilityLabel={`Dismiss ${toast.title}`}
        size="xs"
        onPress={() => onDismiss(toast.id)}
      />
    </Animated.View>
  );
}
