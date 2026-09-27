/**
 * Trackit X — Settings.
 *
 * The settings surface is now real in one section and honest about the rest.
 *
 * AI Providers is built: an administrator can point the future Copilot at a
 * provider, choose its model, switch it on or off, and set the organization
 * default, with every one of those decisions enforced by the database.
 *
 * Organization and Preferences are listed as not built. They were previously
 * three tab chips that looked live and led to placeholder boxes, and a control
 * that cannot do its job is worse than an absent one. `updateOrganization()` and
 * the theme switch already exist in `more.tsx`, so the sections are named as
 * coming rather than duplicated badly here.
 */
import { View } from 'react-native';

import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
import { PageHeader } from '@/components/navigation/PageHeader';
import {
  Badge,
  Card,
  createStyles,
  Divider,
  HStack,
  Icon,
  ScreenContainer,
  Text,
  useStyles,
  VStack,
} from '@/design-system';
import { AIProvidersView } from '@/features/ai-providers/AIProvidersView';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';

const styles = createStyles((theme) => ({
  sectionHeader: {
    alignItems: 'center',
  },
  sectionBody: {
    gap: theme.space[1],
    marginTop: theme.space[2],
  },
}));

/** Sections named so an administrator can see the shape of what is coming. */
const PENDING_SECTIONS = [
  {
    icon: 'organization' as const,
    title: 'Organization',
    description:
      'Name, business type, timezone and currency. The record and the update service already exist; the form does not.',
  },
  {
    icon: 'theme' as const,
    title: 'Preferences',
    description:
      'Appearance, notifications and localisation. The theme preference lives in More for now.',
  },
];

export default function SettingsScreen(): React.JSX.Element {
  const s = useStyles(styles);

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

        <Divider />

        <VStack gap={3}>
          <HStack gap={2}>
            <Icon name="more" size="sm" tone="tertiary" />
            <Text variant="h4">Also in Settings</Text>
          </HStack>

          {PENDING_SECTIONS.map((section) => (
            <Card key={section.title} variant="outline" padding={4}>
              <View>
                <HStack gap={2} style={s.sectionHeader}>
                  <Icon name={section.icon} size="sm" tone="tertiary" />
                  <Text variant="body" weight="semibold">
                    {section.title}
                  </Text>
                  <Badge label="Not built" intent="neutral" variant="outline" size="sm" />
                </HStack>
                <Text tone="tertiary" style={s.sectionBody}>
                  {section.description}
                </Text>
              </View>
            </Card>
          ))}
        </VStack>
      </VStack>
    </ScreenContainer>
  );
}
