/**
 * Trackit X — auth screen frame.
 *
 * The shared shell behind sign-in, sign-up, password recovery and password reset.
 * Four screens differ only in their fields and their one action, so the frame —
 * brand mark, title, error banner, footer link, keyboard handling — lives once.
 *
 * ── What this rewrite changed, and what it deliberately did not ─────────────
 * The visual language is now the landing page's: the same gradient backdrop, the
 * same wordmark, the same glass panel, the same entrance. The props are byte-for-byte
 * the ones the four screens already pass, and nothing here touches a credential, a
 * submit handler, or the error text it is given — the frame draws what it is handed.
 * That boundary is why a visual pass on this file cannot weaken authentication.
 *
 * ── Why this frame owns keyboard avoidance ──────────────────────────────────
 * `ScreenContainer` deliberately does not include a `KeyboardAvoidingView`,
 * because on a scrolling data screen it fights the scroll view and produces a
 * jumping layout. An auth form is the opposite case: a short, centred, non-
 * scrolling column where the keyboard covers the submit button outright. So the
 * behaviour belongs here rather than in the container.
 */
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeroBackdrop, LazyOrbit, Reveal, Wordmark } from '@/components/marketing';
import {
  Card,
  createStyles,
  HStack,
  Icon,
  Text,
  useResponsive,
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
  root: {
    flex: 1,
    backgroundColor: theme.colors.canvas,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  orbitLayer: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    // Held well back: this is atmosphere behind a form, and a form is the one
    // place a moving background must not compete for attention.
    opacity: 0.4,
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
  errorBanner: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger.subtle,
    borderWidth: 1,
    borderColor: theme.colors.danger.border,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2.5],
  },
  errorText: {
    flex: 1,
    minWidth: 0,
  },
}));

export function AuthScreen({ title, subtitle, children, errorMessage, footer }: AuthScreenProps) {
  const s = useStyles(styles);
  const insets = useSafeAreaInsets();
  const { width, isCompact } = useResponsive();

  return (
    <View style={s.root}>
      <HeroBackdrop />

      {/* Only where there is room beside the panel. On a phone the form occupies
          the screen, so a visualization behind it would be under the fields. */}
      {isCompact ? null : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.orbitLayer]}>
          <LazyOrbit size={Math.round(Math.min(width * 0.42, 440))} lightweight />
        </View>
      )}

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
          {/* One entrance for the whole column rather than a staggered sequence:
              a form that assembles itself in stages delays the first tap. */}
          <Reveal distance={12} style={s.column}>
            <VStack gap={6}>
              <VStack gap={5}>
                <Wordmark withSubtitle />

                <VStack gap={2}>
                  <Text variant="h1">{title}</Text>
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
                        <Text variant="bodySm" tone="danger" style={s.errorText}>
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
          </Reveal>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
