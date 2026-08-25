/**
 * Trackit X — dashboard section frame.
 *
 * A titled block with an optional aside. Local to the dashboard rather than in the
 * design system because it encodes one dashboard-specific rule: a section may carry
 * a `notBuilt` note, and when it does, that note is rendered *above* the section's
 * content instead of beside it — so the caveat cannot be missed by someone scanning
 * the numbers.
 *
 * The rule exists because Phase 1's dashboard is mostly scaffolding. A section that
 * looked complete and showed nothing would read as "your business has no projects",
 * which is a different and much worse statement than "this is not built yet".
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import {
  Badge,
  createStyles,
  HStack,
  Icon,
  Text,
  useStyles,
  VStack,
} from '@/design-system';

export interface DashboardSectionProps {
  title: string;
  /** One line on what the section answers. */
  description?: string;
  /** Right-aligned slot in the header — a filter, a link, a count. */
  aside?: ReactNode;
  /**
   * When set, the section is scaffolding: the string names the phase that fills it,
   * and a visible note says so.
   */
  notBuilt?: string;
  children: ReactNode;
}

const styles = createStyles((theme) => ({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceInset,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
  },
  grow: {
    flex: 1,
  },
}));

export function DashboardSection({
  title,
  description,
  aside,
  notBuilt,
  children,
}: DashboardSectionProps) {
  const s = useStyles(styles);

  return (
    <VStack gap={3}>
      <HStack gap={3} align="flex-start">
        <VStack gap={1} style={s.grow}>
          <HStack gap={2} align="center" wrap>
            <Text variant="h4">{title}</Text>
            {notBuilt === undefined ? null : (
              <Badge label={notBuilt} intent="warning" variant="soft" size="sm" />
            )}
          </HStack>
          {description === undefined ? null : (
            <Text variant="bodySm" tone="secondary">
              {description}
            </Text>
          )}
        </VStack>
        {aside === undefined ? null : aside}
      </HStack>

      {notBuilt === undefined ? null : (
        <View style={s.note}>
          <Icon name="info" size="sm" tone="tertiary" />
          <Text variant="caption" tone="tertiary" style={s.grow}>
            Nothing below is real data — this section has no tables behind it yet.
          </Text>
        </View>
      )}

      {children}
    </VStack>
  );
}
