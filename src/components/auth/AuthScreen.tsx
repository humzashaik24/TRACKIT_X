/**
 * Trackit X — auth screen frame.
 *
 * The shared shell behind sign-in, sign-up, password recovery and password reset.
 * Four screens differ only in their fields and their one action, so the frame —
 * brand mark, title, error banner, footer link, keyboard handling — lives once.
 *
 * ── Why this frame owns keyboard avoidance ──────────────────────────────────
 * `ScreenContainer` deliberately does not include a `KeyboardAvoidingView`,
 * because on a scrolling data screen it fights the scroll view and produces a
 * jumping layout. An auth form is the opposite case: a short, centred, non-
 * scrolling column where the keyboard covers the submit button outright. So the
 * behaviour belongs here rather than in the container.
 */
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Card,
  createStyles,
  HStack,
  Icon,
  Text,
  useStyles,
  VStack,
} from '@/design-system';

export interface AuthScreenProps {
  title: string;
  /** One sentence on what this screen does. Plain language, no marketing. */
  subtitle: string;
  children: ReactNode;
  /**
   * A form-level failure, already safe to show a user — i.e. `AppError.userMessage`,
   * never a raw Supabase message, which can leak whether an account exists.
   */
  errorMessage?: string | undefined;
  /** Sign-in ⇄ sign-up cross-links, "back to sign in", and so on. */
  footer?: ReactNode;
}

const styles = createStyles((theme) => ({
  flex: {
    flex: 1,
    backgroundColor: theme.colors.canvas,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.space[5],
    paddingVertical: theme.space[8],
  },
  column: {
    width: '100%',
    // A form wider than this reads as a settings page, and long labels stop
    // scanning as a single vertical column.
    maxWidth: 420,
    alignSelf: 'center',
  },
  mark: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent.subtle,
    borderWidth: 1,
    borderColor: theme.colors.accent.border,
  },
  errorBanner: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger.subtle,
    borderWidth: 1,
    borderColor: theme.colors.danger.border,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2.5],
  },
}));

export function AuthScreen({
  title,
  subtitle,
  children,
  errorMessage,
  footer,
}: AuthScreenProps) {
  const s = useStyles(styles);
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={s.flex}
      // `padding` on iOS, `height` on Android: Android already resizes the window
      // for the keyboard, and `padding` there double-counts it.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        // The form is short; bouncing makes a centred column feel unanchored.
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <VStack gap={6} style={s.column}>
          <VStack gap={4}>
            <HStack gap={3} align="center">
              <View style={s.mark}>
                <Icon name="aiSpark" size="md" tone="accent" />
              </View>
              <VStack gap={0}>
                <Text variant="overline" tone="tertiary" uppercase>
                  Trackit X
                </Text>
                <Text variant="bodySm" tone="tertiary">
                  Business operating system
                </Text>
              </VStack>
            </HStack>

            <VStack gap={2}>
              <Text variant="h2">{title}</Text>
              <Text variant="body" tone="secondary">
                {subtitle}
              </Text>
            </VStack>
          </VStack>

          <Card variant="glass" padding={5} corner="xl">
            <VStack gap={4}>
              {errorMessage === undefined ? null : (
                <View
                  style={s.errorBanner}
                  // `alert` makes a screen reader announce the failure instead of
                  // leaving it to be discovered by swiping back up the form.
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  <HStack gap={2} align="center">
                    <Icon name="danger" size="sm" tone="danger" />
                    <Text variant="bodySm" tone="danger" style={{ flex: 1 }}>
                      {errorMessage}
                    </Text>
                  </HStack>
                </View>
              )}

              {children}
            </VStack>
          </Card>

          {footer === null || footer === undefined ? null : footer}
        </VStack>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
