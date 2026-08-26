/**
 * Trackit X — more.
 *
 * The one destination besides the dashboard that is genuinely finished, because
 * everything it shows already exists: the organization record, the caller's role, the
 * theme preference, and the session. Nothing here is derived from a table that has
 * not been built.
 *
 * Two deliberate absences worth stating:
 *
 *   · No "Manage members" or "Invite people". Invitations need an invite table, an
 *     email path and a membership-writing policy, none of which exist — and a button
 *     that opens a screen which cannot complete the job is worse than no button.
 *   · No "Edit organization", even though `updateOrganization()` exists in the
 *     service. The UPDATE policy requires `admin` or above, so the form would have to
 *     handle a refusal it cannot predict from client state; that screen is worth
 *     doing properly rather than half.
 *
 * The role badge is presentation only. It is read from the membership row the
 * database already decided to show this user, and changing it locally would change
 * nothing about what any request is permitted to do.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Badge,
  Button,
  Card,
  createStyles,
  Divider,
  HStack,
  Icon,
  ScreenContainer,
  Select,
  Text,
  useStyles,
  useThemeController,
  useToast,
  VStack,
  type SelectOption,
  type ThemePreference,
} from '@/design-system';
import {
  BUSINESS_TYPE_LABELS,
  isBusinessType,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '@/domain/organization';

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
    // Long timezone names wrap rather than truncate — the value is the point of
    // the row, so losing its end would defeat it.
    flexShrink: 1,
  },
  selfStart: {
    alignSelf: 'flex-start',
  },
}));

const THEME_OPTIONS: readonly SelectOption<ThemePreference>[] = [
  { value: 'dark', label: 'Dark', description: 'The default. Built for long sessions.', icon: 'theme' },
  { value: 'light', label: 'Light', description: 'For bright sites and daylight.', icon: 'theme' },
  {
    value: 'system',
    label: 'Match device',
    description: 'Follows your phone’s appearance setting.',
    icon: 'settings',
  },
];

/** A label/value pair. Values come from the database or the session, never invented. */
function DetailRow({
  icon,
  label,
  value,
}: {
  icon: 'organization' | 'tag' | 'time' | 'cash' | 'mail' | 'user';
  label: string;
  value: string;
}) {
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

export default function MoreScreen() {
  const s = useStyles(styles);
  const toast = useToast();
  const { displayName, user, signOut } = useAuth();
  const { organization, role, memberships, selectOrganization } = useOrganization();
  const { preference, setPreference } = useThemeController();
  const [signingOut, setSigningOut] = useState(false);

  const businessTypeLabel = isBusinessType(organization?.business_type)
    ? BUSINESS_TYPE_LABELS[organization.business_type]
    : null;

  const workspaceOptions = useMemo<readonly SelectOption[]>(
    () =>
      memberships.map((membership) => ({
        value: membership.organization.id,
        label: membership.organization.name,
        description: ROLE_LABELS[membership.role],
        icon: 'organization' as const,
      })),
    [memberships],
  );

  const handleSignOut = useCallback(async (): Promise<void> => {
    setSigningOut(true);
    const result = await signOut();
    if (!result.ok) {
      // Left on this screen rather than optimistically navigating: if the sign-out
      // failed the session is still live, and showing the auth screens would be a
      // lie about the state of the app. The route gate does the navigation when the
      // session actually ends.
      setSigningOut(false);
      toast.show({
        title: 'Could not sign out',
        message: result.error.userMessage,
        intent: 'danger',
      });
    }
  }, [signOut, toast]);

  return (
    <ScreenContainer
      edges={['top', 'bottom']}
      gap={20}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
    >
      <VStack gap={1}>
        <Text variant="h2">More</Text>
        <Text variant="bodySm" tone="secondary">
          Your workspace, how the app looks, and your account.
        </Text>
      </VStack>

      {/* ── Organization ───────────────────────────────────────────────────── */}
      <VStack gap={3}>
        <Text variant="h4">Organization</Text>
        {organization === null ? (
          <Card variant="outline" padding={4}>
            <Text variant="bodySm" tone="secondary">
              No organization is selected. This should not be reachable — the route
              gate sends a user without one to onboarding.
            </Text>
          </Card>
        ) : (
          <Card variant="solid" padding={4}>
            <VStack gap={0}>
              <DetailRow icon="organization" label="Name" value={organization.name} />
              <Divider subtle />
              <DetailRow
                icon="tag"
                label="Sector"
                value={businessTypeLabel ?? organization.business_type}
              />
              <Divider subtle />
              <DetailRow icon="time" label="Time zone" value={organization.timezone} />
              <Divider subtle />
              <DetailRow icon="cash" label="Currency" value={organization.currency} />
            </VStack>
          </Card>
        )}

        {role === null ? null : (
          <Card variant="outline" padding={4}>
            <VStack gap={2}>
              <HStack gap={2} align="center" wrap>
                <Text variant="label">Your access</Text>
                <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
              </HStack>
              <Text variant="bodySm" tone="secondary">
                {ROLE_DESCRIPTIONS[role]}
              </Text>
              <Text variant="caption" tone="tertiary">
                Enforced by the database on every request, not by this screen.
              </Text>
            </VStack>
          </Card>
        )}

        {/*
          Shown only with something to switch between. A picker holding one option is
          a control that cannot do anything.
        */}
        {memberships.length < 2 ? null : (
          <Select
            label="Active workspace"
            options={workspaceOptions}
            value={organization?.id ?? null}
            onChange={(organizationId) => {
              selectOrganization(organizationId);
            }}
            helperText="Switching changes every screen in the app."
          />
        )}
      </VStack>

      <Divider />

      {/* ── Appearance ─────────────────────────────────────────────────────── */}
      <VStack gap={3}>
        <Text variant="h4">Appearance</Text>
        <Select
          label="Theme"
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
          helperText="Saved on this device."
        />
      </VStack>

      <Divider />

      {/* ── Account ────────────────────────────────────────────────────────── */}
      <VStack gap={3}>
        <Text variant="h4">Account</Text>
        <Card variant="solid" padding={4}>
          <VStack gap={0}>
            <DetailRow icon="user" label="Name" value={displayName} />
            {/*
              `user.email` is the address the session authenticates as, straight from
              the token — unlike `user_metadata`, it is not user-writable, so it is
              safe to present as fact.
            */}
            <Divider subtle />
            <DetailRow icon="mail" label="Email" value={user?.email ?? 'Not available'} />
          </VStack>
        </Card>

        <View style={s.selfStart}>
          <Button
            label="Sign out"
            variant="outline"
            intent="danger"
            iconLeft="logout"
            loading={signingOut}
            onPress={() => {
              void handleSignOut();
            }}
          />
        </View>
      </VStack>

      <Text variant="caption" tone="tertiary">
        Inviting people, editing organization details and managing roles arrive with the
        member-management screens. Nothing on this page is a placeholder — every value
        above is read from your account or your organization record.
      </Text>
    </ScreenContainer>
  );
}
