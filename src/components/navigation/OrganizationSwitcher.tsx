/**
 * Trackit X — OrganizationSwitcher.
 *
 * The current workspace and the switch between workspaces the signed-in user
 * belongs to. Read entirely from `useOrganization()`, which in turn reads the
 * membership list the database chose to show this user — never a client-side
 * list the app invented, and never a selection the context refuses.
 *
 * The RLS boundary is untouched by this component: `selectOrganization` only
 * changes which tenant the UI scopes queries to, and every query is still
 * filtered by Postgres. Switching can never widen what a user sees.
 *
 * Honesty rule from `more.tsx` kept: with a single membership the trigger is a
 * plain badge — a picker holding one option is a control that cannot do
 * anything.
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Badge,
  createStyles,
  Divider,
  Icon,
  Text,
  useResponsive,
  useStyles,
  useTheme,
  VStack,
} from '@/design-system';
import { useOrganization } from '@/contexts/OrganizationContext';
import { ROLE_LABELS } from '@/domain/organization';

import { HeaderPopover } from './HeaderPopover';

/** A membership presented as a switchable choice. Pure — unit-testable. */
export interface OrganizationChoice {
  readonly id: string;
  readonly name: string;
  readonly roleLabel: string;
  readonly active: boolean;
}

export function membershipChoices(
  memberships: readonly {
    organization: { id: string; name: string };
    role: keyof typeof ROLE_LABELS;
  }[],
  activeOrganizationId: string | null,
): readonly OrganizationChoice[] {
  return memberships.map((membership) => ({
    id: membership.organization.id,
    name: membership.organization.name,
    roleLabel: ROLE_LABELS[membership.role],
    active: membership.organization.id === activeOrganizationId,
  }));
}

const styles = createStyles((theme) => ({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
    borderRadius: theme.radius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  badgeRow: {
    maxWidth: 220,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    paddingHorizontal: theme.space[4],
    paddingVertical: theme.space[3],
  },
}));

export function OrganizationSwitcher() {
  const s = useStyles(styles);
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const { memberships, organization, role, selectOrganization } = useOrganization();
  const [open, setOpen] = useState(false);

  const choices = useMemo(
    () => membershipChoices(memberships, organization?.id ?? null),
    [memberships, organization?.id],
  );

  const canSwitch = choices.length > 1;
  const name = organization?.name ?? 'Your business';
  const roleLabel = role === null ? null : ROLE_LABELS[role];

  // A single membership renders as context, not as a control.
  if (!canSwitch) {
    return (
      <View
        style={s.badgeRow}
        accessible
        accessibilityLabel={`${name}${roleLabel === null ? '' : `, ${roleLabel}`}`}
      >
        <Badge
          label={isCompact ? name : `${name}${roleLabel === null ? '' : ` · ${roleLabel}`}`}
          intent="accent"
          variant="soft"
          size="sm"
        />
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Switch workspace. Current: ${name}`}
        tabIndex={0}
        style={({ hovered }) => [s.trigger, hovered && s.triggerHovered]}
      >
        <Icon name="organization" size="md" tone="accent" />
        {!isCompact && (
          <>
            <Text variant="label" numberOfLines={1} style={{ maxWidth: 168 }}>
              {name}
            </Text>
            <Icon name="chevronDown" size="sm" tone="tertiary" />
          </>
        )}
      </Pressable>

      {open && (
        <HeaderPopover onClose={() => setOpen(false)} width={320}>
          <View style={{ padding: theme.space[4], paddingBottom: theme.space[3] }}>
            <Text variant="overline" tone="tertiary">
              Switch workspace
            </Text>
          </View>
          <Divider subtle />
          {choices.map((choice) => (
            <Pressable
              key={choice.id}
              onPress={() => {
                selectOrganization(choice.id);
                setOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${choice.name}, ${choice.roleLabel}${choice.active ? ', active' : ''}`}
              accessibilityState={{ selected: choice.active }}
              style={({ pressed }) => [
                s.row,
                {
                  backgroundColor: pressed
                    ? theme.colors.surfacePressed
                    : choice.active
                      ? theme.colors.accent.subtle
                      : 'transparent',
                },
              ]}
            >
              <Icon name="organization" size="md" tone={choice.active ? 'accent' : 'secondary'} />
              <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" tone={choice.active ? 'accent' : 'primary'} numberOfLines={1}>
                  {choice.name}
                </Text>
                <Text variant="caption" tone="tertiary" numberOfLines={1}>
                  {choice.roleLabel}
                </Text>
              </VStack>
              {choice.active && <Icon name="check" size="md" tone="accent" />}
            </Pressable>
          ))}
          <Divider subtle />
          <View style={{ padding: theme.space[3] }}>
            <Text variant="caption" tone="tertiary">
              Every screen re-scopes to the selected business. Access is still
              enforced by the database on each request.
            </Text>
          </View>
        </HeaderPopover>
      )}
    </>
  );
}