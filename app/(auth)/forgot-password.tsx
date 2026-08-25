/**
 * Trackit X — forgot password.
 *
 * ── Why the success message is deliberately vague ───────────────────────────
 * The screen says "if an account exists, we sent a link" and shows that for BOTH
 * outcomes. Confirming that an address is registered turns this form into an
 * account-enumeration oracle: an attacker can walk a list of a company's email
 * addresses and learn which ones are Trackit X users, which is the first step in a
 * targeted phishing campaign. Supabase's API is deliberately uninformative here and
 * this screen preserves that property rather than undoing it for friendlier copy.
 */
import { Link } from 'expo-router';
import { useCallback, useState } from 'react';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { useAuth } from '@/contexts/AuthContext';
import { Button, HStack, Icon, Input, Text, VStack } from '@/design-system';
import {
  forgotPasswordSchema,
  validateForm,
  type FieldErrors,
  type ForgotPasswordInput,
} from '@/features/auth/schema';

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<ForgotPasswordInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(forgotPasswordSchema, { email });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    const result = await requestPasswordReset(parsed.values.email);
    setSubmitting(false);

    // Only a transport-level failure is surfaced. "No such account" is not
    // reported — see the note at the top of this file.
    if (!result.ok && result.error.retryable) {
      setFormError(result.error.userMessage);
      return;
    }

    setSent(true);
  }, [email, requestPasswordReset]);

  const backToSignIn = (
    <HStack gap={2} justify="center" align="center" wrap>
      <Text variant="bodySm" tone="secondary">
        Remembered it?
      </Text>
      <Link href="/sign-in">
        <Text variant="bodySm" tone="accent">
          Back to sign in
        </Text>
      </Link>
    </HStack>
  );

  if (sent) {
    return (
      <AuthScreen
        title="Check your email"
        subtitle="If an account exists for that address, a reset link is on its way."
        footer={backToSignIn}
      >
        <HStack gap={3} align="flex-start">
          <Icon name="mail" size="md" tone="accent" />
          <Text variant="bodySm" tone="secondary" style={{ flex: 1 }}>
            The link is valid for one hour and can be used once. Opening it brings you
            straight back here to choose a new password.
          </Text>
        </HStack>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Reset your password"
      subtitle="Enter your work email and we will send a reset link."
      errorMessage={formError}
      footer={backToSignIn}
    >
      <VStack gap={4}>
        <Input
          label="Work email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          iconLeft="mail"
          placeholder="you@business.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => {
            void submit();
          }}
          editable={!submitting}
          required
        />

        <Button
          label="Send reset link"
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
