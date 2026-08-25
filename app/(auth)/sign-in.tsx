/**
 * Trackit X — sign in.
 */
import { Link } from 'expo-router';
import { useCallback, useState } from 'react';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { useAuth } from '@/contexts/AuthContext';
import { Button, HStack, Input, Text, VStack } from '@/design-system';
import {
  signInSchema,
  validateForm,
  type FieldErrors,
  type SignInInput,
} from '@/features/auth/schema';

export default function SignInScreen() {
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<SignInInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(signInSchema, { email, password });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    const result = await signIn(parsed.values);
    setSubmitting(false);

    // No navigation on success. The session change propagates through
    // AuthContext → useRouteGate → this group's RouteGate, which redirects. Doing
    // it here as well would race the gate and could push a second screen.
    if (!result.ok) setFormError(result.error.userMessage);
  }, [email, password, signIn]);

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to your business workspace."
      errorMessage={formError}
      footer={
        <HStack gap={2} justify="center" align="center" wrap>
          <Text variant="bodySm" tone="secondary">
            New to Trackit X?
          </Text>
          <Link href="/sign-up">
            <Text variant="bodySm" tone="accent">
              Create an account
            </Text>
          </Link>
        </HStack>
      }
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
          returnKeyType="next"
          editable={!submitting}
          required
        />

        <VStack gap={2}>
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            iconLeft="lock"
            placeholder="Your password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => {
              void submit();
            }}
            editable={!submitting}
            required
          />
          <HStack justify="flex-end">
            <Link href="/forgot-password">
              <Text variant="bodySm" tone="accent">
                Forgot your password?
              </Text>
            </Link>
          </HStack>
        </VStack>

        <Button
          label="Sign in"
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
