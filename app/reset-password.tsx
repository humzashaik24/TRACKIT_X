/**
 * Trackit X — set a new password.
 *
 * ── Why this route is at the root, outside `(auth)` ─────────────────────────
 * Following a recovery link establishes a real Supabase session, so at this moment
 * the user IS signed in. Inside the `(auth)` group the layout's gate would see that
 * and redirect them to the dashboard before they could type anything — the reset
 * link would appear to "work" while silently doing nothing. At the root it is
 * reachable in every zone, which is also what keeps `/reset-password` matching the
 * exact redirect URLs configured in `supabase/config.toml`.
 *
 * ── Two ways the session arrives ────────────────────────────────────────────
 * PKCE puts a single-use `code` in the redirect URL.
 *   · Web    — `detectSessionInUrl` is on, so supabase-js consumes the code before
 *              this screen mounts and the session simply exists.
 *   · Native — the link arrives as a `trackitx://reset-password?code=…` deep link
 *              and nothing has exchanged it, so this screen must.
 * Both paths converge on "is there a session?", which is why the code below asks
 * that question rather than branching on platform.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { BrandSplash } from '@/components/BrandSplash';
import { useAuth } from '@/contexts/AuthContext';
import { Button, HStack, Icon, Input, Text, VStack } from '@/design-system';
import {
  PASSWORD_RULE_HINT,
  resetPasswordSchema,
  validateForm,
  type FieldErrors,
  type ResetPasswordInput,
} from '@/features/auth/schema';
import { completeAuthLink } from '@/services/authService';

export default function ResetPasswordScreen() {
  const { status, isSignedIn, updatePassword } = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' && params.code.length > 0 ? params.code : null;

  const [exchanging, setExchanging] = useState(code !== null);
  const [linkFailed, setLinkFailed] = useState(false);
  const exchangeStarted = useRef(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<ResetPasswordInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (code === null || exchangeStarted.current) return;
    exchangeStarted.current = true;

    let cancelled = false;
    void (async () => {
      const result = await completeAuthLink(code);
      if (cancelled) return;
      setExchanging(false);
      // A failure here is expected on web, where supabase-js already spent the
      // code. `isSignedIn` is the real test, so the error is only recorded — the
      // render below prefers a live session over this flag.
      if (!result.ok) setLinkFailed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(resetPasswordSchema, { password, confirmPassword });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    const result = await updatePassword(parsed.values.password);
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.error.userMessage);
      return;
    }

    setChanged(true);
  }, [confirmPassword, password, updatePassword]);

  if (status === 'restoring' || exchanging) {
    return <BrandSplash label="Verifying your reset link" />;
  }

  if (changed) {
    return (
      <AuthScreen
        title="Password updated"
        subtitle="Your new password is active on this device and everywhere else you sign in."
      >
        <VStack gap={4}>
          <HStack gap={3} align="flex-start">
            <Icon name="success" size="md" tone="success" />
            <Text variant="bodySm" tone="secondary" style={{ flex: 1 }}>
              You are signed in already — there is nothing else to do here.
            </Text>
          </HStack>
          <Button
            label="Continue"
            onPress={() => {
              // Back to the entry gate rather than a fixed screen: this user may
              // still need to create their first organization.
              router.replace('/');
            }}
            fullWidth
            size="lg"
          />
        </VStack>
      </AuthScreen>
    );
  }

  if (!isSignedIn) {
    return (
      <AuthScreen
        title="This link cannot be used"
        subtitle={
          linkFailed || code !== null
            ? 'Reset links expire after an hour and work only once. Request a fresh one and try again.'
            : 'Open the reset link from your email to change your password.'
        }
      >
        <Button
          label="Request a new link"
          onPress={() => {
            router.replace('/forgot-password');
          }}
          fullWidth
          size="lg"
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Choose a new password"
      subtitle="Pick something you have not used on this account before."
      errorMessage={formError}
    >
      <VStack gap={4}>
        <Input
          label="New password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          helperText={PASSWORD_RULE_HINT}
          iconLeft="lock"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          editable={!submitting}
          required
        />

        <Input
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={fieldErrors.confirmPassword}
          iconLeft="lock"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => {
            void submit();
          }}
          editable={!submitting}
          required
        />

        <Button
          label="Update password"
          onPress={() => {
            void submit();
          }}
          loading={submitting}
          disabled={submitting}
          fullWidth
          size="lg"
        />
      </VStack>
    </AuthScreen>
  );
}
