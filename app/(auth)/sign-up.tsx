/**
 * Trackit X — sign up.
 *
 * ── The confirmation branch ─────────────────────────────────────────────────
 * `supabase/config.toml` has `enable_confirmations = true`, so a successful sign-up
 * usually returns NO session — the account exists but is unusable until the email
 * link is followed. That is not an error and must not be shown as one, and it also
 * must not silently do nothing: this screen swaps to an explicit "check your inbox"
 * state so the user knows the next step is in their email client, not here.
 */
import { Link } from 'expo-router';
import { useCallback, useState } from 'react';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { useAuth } from '@/contexts/AuthContext';
import { Button, HStack, Icon, Input, Text, VStack } from '@/design-system';
import {
  PASSWORD_RULE_HINT,
  signUpSchema,
  validateForm,
  type FieldErrors,
  type SignUpInput,
} from '@/features/auth/schema';

export default function SignUpScreen() {
  const { signUp } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<SignUpInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(signUpSchema, {
      fullName,
      email,
      password,
      confirmPassword,
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    const result = await signUp({
      fullName: parsed.values.fullName,
      email: parsed.values.email,
      password: parsed.values.password,
    });
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.error.userMessage);
      return;
    }

    if (result.value.needsEmailConfirmation) {
      setConfirmationSentTo(parsed.values.email);
      return;
    }

    // A session came back, which means confirmations are off in this environment.
    // The route gate takes over from here — no navigation call needed.
  }, [confirmPassword, email, fullName, password, signUp]);

  if (confirmationSentTo !== null) {
    return (
      <AuthScreen
        title="Confirm your email"
        subtitle={`We sent a confirmation link to ${confirmationSentTo}. Open it to activate your account.`}
        footer={
          <HStack gap={2} justify="center" align="center" wrap>
            <Text variant="bodySm" tone="secondary">
              Already confirmed?
            </Text>
            <Link href="/sign-in">
              <Text variant="bodySm" tone="accent">
                Sign in
              </Text>
            </Link>
          </HStack>
        }
      >
        <VStack gap={4}>
          <HStack gap={3} align="flex-start">
            <Icon name="mail" size="md" tone="accent" />
            <Text variant="bodySm" tone="secondary" style={{ flex: 1 }}>
              The link opens Trackit X and signs you in. If it is not in your inbox
              within a few minutes, check the spam folder — confirmation mail is a
              common casualty of business mail filters.
            </Text>
          </HStack>

          <Button
            label="Use a different email"
            variant="ghost"
            onPress={() => {
              setConfirmationSentTo(null);
              setPassword('');
              setConfirmPassword('');
            }}
            fullWidth
          />
        </VStack>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Create your account"
      subtitle="One account, then you set up your business."
      errorMessage={formError}
      footer={
        <HStack gap={2} justify="center" align="center" wrap>
          <Text variant="bodySm" tone="secondary">
            Already have an account?
          </Text>
          <Link href="/sign-in">
            <Text variant="bodySm" tone="accent">
              Sign in
            </Text>
          </Link>
        </HStack>
      }
    >
      <VStack gap={4}>
        <Input
          label="Your name"
          value={fullName}
          onChangeText={setFullName}
          error={fieldErrors.fullName}
          iconLeft="user"
          placeholder="Priya Sharma"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          editable={!submitting}
          required
        />

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
          returnKeyType="next"
          editable={!submitting}
          required
        />

        <Input
          label="Password"
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
          label="Confirm password"
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
          label="Create account"
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
