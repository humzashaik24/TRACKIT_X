/**
 * Trackit X — create the first organization.
 *
 * The one screen between a new account and a working workspace. Four fields, all
 * of them things the rest of the product cannot be correct without:
 *
 *   name          what the business is called
 *   businessType  shapes later defaults — a construction firm and a retailer need
 *                 different project and inventory vocabularies
 *   timezone      attendance and payroll are date-bounded, and a day boundary in
 *                 the wrong zone silently misattributes a shift
 *   currency      every monetary figure is stored against it
 *
 * ── The role is not sent from here ──────────────────────────────────────────
 * `createOrganization` calls a `SECURITY DEFINER` RPC that inserts the organization
 * and the caller's membership in one transaction, and it hard-codes `owner` server
 * side. This screen has no field, parameter or code path that can name a role — that
 * is the point. A client that could ask for its own role could ask for `owner` in
 * someone else's organization.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Button,
  Card,
  createStyles,
  Divider,
  HStack,
  Icon,
  Input,
  ScreenContainer,
  Select,
  Text,
  useStyles,
  VStack,
} from '@/design-system';
import {
  businessTypeOptions,
  currencyOptions,
  DEFAULT_CURRENCY,
  guessTimezone,
  ORGANIZATION_NAME_MAX,
  timezoneOptions,
  type BusinessType,
} from '@/domain/organization';
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
} from '@/features/organization/schema';
import { validateForm, type FieldErrors } from '@/features/auth/schema';

const styles = createStyles((theme) => ({
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
  banner: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger.subtle,
    borderWidth: 1,
    borderColor: theme.colors.danger.border,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2.5],
  },
  column: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
}));

export default function CreateOrganizationScreen() {
  const s = useStyles(styles);
  const { displayName, signOut } = useAuth();
  const { createOrganization } = useOrganization();

  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  // Seeded from the device, because it is right far more often than not — but it is
  // an editable field, since a phone travels and a business does not.
  const [timezone, setTimezone] = useState<string>(() => guessTimezone());
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors<CreateOrganizationInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // ~600 IANA zones. Building the option list on every keystroke of the name field
  // would be the most expensive thing on this screen.
  const zoneOptions = useMemo(() => timezoneOptions, []);

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(createOrganizationSchema, {
      name,
      businessType,
      timezone,
      currency,
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    const result = await createOrganization(parsed.values);
    setSubmitting(false);

    // On success the membership list reloads, `needsOnboarding` turns false, and the
    // gate moves us to the dashboard. No navigation call belongs here.
    if (!result.ok) setFormError(result.error.userMessage);
  }, [businessType, createOrganization, currency, name, timezone]);

  return (
    <ScreenContainer edges={['top', 'bottom']} maxWidth={640}>
      <VStack gap={6} style={s.column}>
        <VStack gap={4}>
          <HStack gap={3} align="center">
            <View style={s.mark}>
              <Icon name="organization" size="md" tone="accent" />
            </View>
            <VStack gap={0}>
              <Text variant="overline" tone="tertiary" uppercase>
                Step 1 of 1
              </Text>
              <Text variant="bodySm" tone="tertiary">
                Signed in as {displayName}
              </Text>
            </VStack>
          </HStack>

          <VStack gap={2}>
            <Text variant="h2">Set up your business</Text>
            <Text variant="body" tone="secondary">
              This creates your workspace. Everything you add later — projects, people,
              stock — belongs to it and is visible to nobody outside it.
            </Text>
          </VStack>
        </VStack>

        <Card variant="glass" padding={5} corner="xl">
          <VStack gap={4}>
            {formError === undefined ? null : (
              <View style={s.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <HStack gap={2} align="center">
                  <Icon name="danger" size="sm" tone="danger" />
                  <Text variant="bodySm" tone="danger" style={{ flex: 1 }}>
                    {formError}
                  </Text>
                </HStack>
              </View>
            )}

            <Input
              label="Business name"
              value={name}
              onChangeText={setName}
              error={fieldErrors.name}
              iconLeft="organization"
              placeholder="Sharma Fabrication Works"
              autoCapitalize="words"
              maxLength={ORGANIZATION_NAME_MAX}
              editable={!submitting}
              required
            />

            <Select
              label="Business type"
              options={businessTypeOptions}
              value={businessType}
              onChange={(value) => setBusinessType(value)}
              error={fieldErrors.businessType}
              placeholder="What kind of business is it?"
              helperText="Used to pick sensible defaults later. You can change it."
              disabled={submitting}
              required
            />

            <Divider subtle />

            <Select
              label="Timezone"
              options={zoneOptions}
              value={timezone}
              onChange={setTimezone}
              error={fieldErrors.timezone}
              searchable
              helperText="Attendance and payroll days are counted in this timezone."
              disabled={submitting}
              required
            />

            <Select
              label="Currency"
              options={currencyOptions}
              value={currency}
              onChange={setCurrency}
              error={fieldErrors.currency}
              searchable
              helperText="Every amount in the workspace is recorded in this currency."
              disabled={submitting}
              required
            />

            <Button
              label="Create workspace"
              onPress={() => {
                void submit();
              }}
              loading={submitting}
              disabled={submitting}
              fullWidth
              size="lg"
              iconRight="arrowRight"
            />
          </VStack>
        </Card>

        <HStack gap={2} justify="center" align="center" wrap>
          <Text variant="bodySm" tone="tertiary">
            Wrong account?
          </Text>
          <Button
            label="Sign out"
            variant="link"
            size="sm"
            onPress={() => {
              void signOut();
            }}
            disabled={submitting}
          />
        </HStack>
      </VStack>
    </ScreenContainer>
  );
}
