/**
 * Trackit X — Settings.
 *
 * Organization-scoped configuration, built from what actually exists:
 *
 *   · AI Providers — configure a provider, pick a model, and toggle the
 *     organization default. Enforced by real database rows and policies.
 *   · Organization — the record, with an edit surface for admin and owner,
 *     who are the update policy's admitted roles.
 *   · Preferences — the theme preference, the same control More offers.
 *
 * Nothing here is a fake switch. The theme preference is persisted per device,
 * the organization record is read and written through the real service, and
 * provider settings are locked down by the structure described in
 * `AIProvidersView`.
 */
import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
import { PageHeader } from '@/components/navigation/PageHeader';
import {
  Card,
  HStack,
  Icon,
  ScreenContainer,
  Select,
  Text,
  useThemeController,
  VStack,
} from '@/design-system';
import { useOrganization } from '@/contexts/OrganizationContext';
import { AIProvidersView } from '@/features/ai-providers/AIProvidersView';
import { OrganizationEditCard } from '@/features/organization/OrganizationEditCard';
import { THEME_OPTIONS } from '@/features/theme/preferences';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';

export default function SettingsScreen(): React.JSX.Element {
  const { organization, role } = useOrganization();
  const { preference, setPreference } = useThemeController();

  return (
    <ScreenContainer
      edges={['bottom']}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
    >
      <PageHeader
        title="Settings"
        description="Organization-scoped configuration. Everything here applies to this workspace only."
        breadcrumbs={deriveBreadcrumbs('/settings')}
        icon="settings"
      />

      <VStack gap={5}>
        <AIProvidersView />

        {/* ── Organization ─────────────────────────────────────────────────── */}
        <VStack gap={3}>
          <HStack gap={2} align="center">
            <Icon name="organization" size="sm" tone="tertiary" />
            <Text variant="h4">Organization</Text>
          </HStack>
          {organization === null ? (
            <Card variant="outline" padding={4}>
              <Text variant="bodySm" tone="secondary">
                No organization is selected. This should not be reachable — the
                route gate sends a user without one to onboarding.
              </Text>
            </Card>
          ) : (
            <OrganizationEditCard organization={organization} role={role} />
          )}
        </VStack>

        {/* ── Preferences ──────────────────────────────────────────────────── */}
        <VStack gap={3}>
          <HStack gap={2} align="center">
            <Icon name="theme" size="sm" tone="tertiary" />
            <Text variant="h4">Preferences</Text>
          </HStack>
          <Select
            label="Theme"
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
            helperText="Saved on this device. Also available from More → Appearance."
          />
          <Text variant="caption" tone="tertiary">
            Appearance is the only preference that exists yet. Notification
            settings arrive with the notification source.
          </Text>
        </VStack>
      </VStack>
    </ScreenContainer>
  );
}