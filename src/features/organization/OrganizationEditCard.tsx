/**
 * Trackit X — organization edit card, used by Settings.
 *
 * More shows the organization as read-only facts. Settings is where the record
 * is maintained, so this card has two modes driven by the caller's role:
 *
 *   · admin or owner — the facts plus an "Edit details" form. The form is the
 *     update side of the same schema `create-organization` uses, and it goes
 *     through `updateOrganization`, whose UPDATE policy admits admin and above.
 *   · member or manager — the facts only, with an honest note that editing
 *     requires a workspace admin. The note must be honest because refusal by
 *     role arrives as a silent no-op, not an error.
 *
 * Reading a refusal: `updateOrganization` matches zero rows when the caller's
 * role is too low, so the update result distinguishes `PERMISSION_DENIED` from
 * a network failure rather than pretending both are the same thing.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  createStyles,
  Divider,
  HStack,
  Icon,
  Input,
  Select,
  Text,
  useStyles,
  useToast,
  VStack,
} from '@/design-system';
import {
  BUSINESS_TYPE_LABELS,
  businessTypeOptions,
  canEditOrganization,
  currencyOptions,
  isBusinessType,
  ORGANIZATION_NAME_MAX,
  ROLE_LABELS,
  timezoneOptions,
  type BusinessType,
  type OrganizationRole,
} from '@/domain/organization';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  updateOrganizationSchema,
  type UpdateOrganizationInput,
} from '@/features/organization/schema';
import { validateForm, type FieldErrors } from '@/features/auth/schema';
import { updateOrganization } from '@/services/organizationService';
import type { OrganizationRow } from '@/types/database';

const styles = createStyles((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[3],
    paddingVertical: theme.space[2],
  },
  rowText: {
    flex: 1,
    gap: theme.space[0.5],
  },
  rowValue: {
    flexShrink: 1,
  },
  selfStart: {
    alignSelf: 'flex-start',
  },
  banner: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger.subtle,
    borderWidth: 1,
    borderColor: theme.colors.danger.border,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2.5],
  },
  success: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.success.subtle,
    borderWidth: 1,
    borderColor: theme.colors.success.border,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2.5],
  },
}));

function FactRow({ icon, label, value }: { icon: 'organization' | 'tag' | 'time' | 'cash'; label: string; value: string }) {
  const s = useStyles(styles);

  return (
    <View style={s.row}>
      <Icon name={icon} size="sm" tone="tertiary" />
      <View style={s.rowText}>
        <Text variant="caption" tone="tertiary">
          {label}
        </Text>
        <Text variant="body" style={s.rowValue}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export interface OrganizationEditCardProps {
  organization: OrganizationRow;
  role: OrganizationRole | null;
}

/** The current organization facts, plus an edit surface for those who may use it. */
export function OrganizationEditCard({ organization, role }: OrganizationEditCardProps) {
  const s = useStyles(styles);
  const toast = useToast();
  const { refresh } = useOrganization();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  const [timezone, setTimezone] = useState<string>('');
  const [currency, setCurrency] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<UpdateOrganizationInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const zoneOptions = useMemo(() => timezoneOptions, []);
  const editable = canEditOrganization(role);
  const businessTypeLabel = isBusinessType(organization.business_type)
    ? BUSINESS_TYPE_LABELS[organization.business_type]
    : organization.business_type;

  const beginEdit = useCallback(() => {
    setName(organization.name);
    setBusinessType(organization.business_type);
    setTimezone(organization.timezone);
    setCurrency(organization.currency);
    setFieldErrors({});
    setFormError(undefined);
    setSaved(false);
    setEditing(true);
  }, [organization]);

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(updateOrganizationSchema, {
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
    const result = await updateOrganization(organization.id, parsed.values);
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.error.userMessage);
      return;
    }

    // The organization record changed; the memberships the app holds are reloaded
    // so the new name shows up in the switcher and here on the next visit.
    void refresh();
    setEditing(false);
    setSaved(true);
    toast.show({
      title: 'Organization updated',
      message: result.value.name,
      intent: 'success',
    });
  }, [businessType, currency, name, organization.id, refresh, timezone, toast]);

  return (
    <Card variant="outline" padding={4}>
      <VStack gap={0}>
        <HStack gap={2} align="center" wrap>
          <Text variant="label">Organization details</Text>
          <Badge label={ROLE_LABELS[role ?? 'member']} intent="accent" variant="soft" size="sm" />
        </HStack>

        <FactRow icon="organization" label="Name" value={organization.name} />
        <Divider subtle />
        <FactRow icon="tag" label="Sector" value={businessTypeLabel} />
        <Divider subtle />
        <FactRow icon="time" label="Time zone" value={organization.timezone} />
        <Divider subtle />
        <FactRow icon="cash" label="Currency" value={organization.currency} />

        {editable ? (
          <>
            <View style={{ marginTop: 14 }}>
              {editing ? (
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
                    autoCapitalize="words"
                    maxLength={ORGANIZATION_NAME_MAX}
                    editable={!submitting}
                  />

                  <Select
                    label="Business type"
                    options={businessTypeOptions}
                    value={businessType}
                    onChange={setBusinessType}
                    error={fieldErrors.businessType}
                    placeholder="What kind of business is it?"
                    disabled={submitting}
                  />

                  <Select
                    label="Timezone"
                    options={zoneOptions}
                    value={timezone}
                    onChange={setTimezone}
                    error={fieldErrors.timezone}
                    searchable
                    disabled={submitting}
                  />

                  <Select
                    label="Currency"
                    options={currencyOptions}
                    value={currency}
                    onChange={setCurrency}
                    error={fieldErrors.currency}
                    searchable
                    disabled={submitting}
                  />

                  <HStack gap={2} wrap>
                    <Button
                      label="Save changes"
                      iconLeft="check"
                      loading={submitting}
                      disabled={submitting}
                      onPress={() => {
                        void submit();
                      }}
                    />
                    <Button
                      label="Cancel"
                      variant="outline"
                      disabled={submitting}
                      onPress={() => setEditing(false)}
                    />
                  </HStack>
                </VStack>
              ) : (
                <VStack gap={2} style={s.selfStart}>
                  {saved ? (
                    <View style={s.success}>
                      <HStack gap={2} align="center">
                        <Icon name="check" size="sm" tone="success" />
                        <Text variant="bodySm" tone="success">
                          Changes saved to the organization record.
                        </Text>
                      </HStack>
                    </View>
                  ) : null}
                  <Button
                    label="Edit organization details"
                    variant="outline"
                    iconLeft="edit"
                    onPress={beginEdit}
                  />
                </VStack>
              )}
            </View>
          </>
        ) : (
          <Text variant="caption" tone="tertiary" style={{ marginTop: 12 }}>
            Editing needs workspace admin access. {ROLE_LABELS[role ?? 'member']} and below see
            the record but cannot change it.
          </Text>
        )}
      </VStack>
    </Card>
  );
}