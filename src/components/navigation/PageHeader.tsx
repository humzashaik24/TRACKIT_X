/**
 * Trackit X — PageHeader.
 *
 * The standard title block at the top of a screen: an optional icon medallion,
 * the title, a one-line description, an optional status badge, an optional
 * breadcrumb trail, and up to two actions. It is the single tallest piece of a
 * screen's identity on purpose — title treatments drawn by hand per screen are
 * how navigation inevitably drifts from the product's hierarchy.
 *
 * Responsive rule: on phones the actions drop to their own row beneath the
 * title so a long title never crowds a button off-screen.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import {
  Button,
  createStyles,
  HStack,
  Icon,
  Text,
  useResponsive,
  useStyles,
  useTheme,
  VStack,
  type ButtonIntent,
  type ButtonVariant,
  type IconName,
} from '@/design-system';
import type { BreadcrumbSegment } from '@/navigation/breadcrumbs';

import { Breadcrumbs } from './Breadcrumbs';

export interface PageHeaderAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  intent?: ButtonIntent;
  loading?: boolean;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: IconName;
  /** Optional status content — a badge, a chip, or a row of both. */
  status?: ReactNode | null;
  breadcrumbs?: readonly BreadcrumbSegment[];
  primaryAction?: PageHeaderAction;
  secondaryAction?: PageHeaderAction;
}

const styles = createStyles((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[4],
    minWidth: 0,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  medallion: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent.subtle,
    borderWidth: 1,
    borderColor: theme.colors.accent.border,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    flexShrink: 0,
    flexWrap: 'wrap',
  },
}));

export function PageHeader({
  title,
  description,
  icon,
  status,
  breadcrumbs,
  primaryAction,
  secondaryAction,
}: PageHeaderProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const { isCompact } = useResponsive();

  const actions = (
    <View style={s.actions}>
      {secondaryAction !== undefined && (
        <Button
          label={secondaryAction.label}
          iconLeft={secondaryAction.icon}
          variant={secondaryAction.variant ?? 'ghost'}
          intent={secondaryAction.intent ?? 'accent'}
          loading={secondaryAction.loading}
          onPress={secondaryAction.onPress}
        />
      )}
      {primaryAction !== undefined && (
        <Button
          label={primaryAction.label}
          iconLeft={primaryAction.icon}
          variant={primaryAction.variant ?? 'primary'}
          intent={primaryAction.intent ?? 'accent'}
          loading={primaryAction.loading}
          onPress={primaryAction.onPress}
        />
      )}
    </View>
  );

  return (
    <VStack gap={isCompact ? 3 : 4}>
      {breadcrumbs !== undefined && breadcrumbs.length > 0 && <Breadcrumbs crumbs={breadcrumbs} />}

      <VStack gap={isCompact ? 3 : 4}>
        <View style={s.row}>
          {icon !== undefined && (
            <View style={s.medallion}>
              <Icon name={icon} size="xl" tone="accent" />
            </View>
          )}

          <VStack gap={1} style={s.grow}>
            <HStack gap={2} align="center" wrap>
              <Text variant={isCompact ? 'h2' : 'h1'} numberOfLines={2}>
                {title}
              </Text>
              {status !== undefined && status !== null && status}
            </HStack>
            {description !== undefined && (
              <Text variant="bodySm" tone="secondary">
                {description}
              </Text>
            )}
          </VStack>

          {isCompact ? null : actions}
        </View>

        {/* The actions own a row on phones rather than being squeezed beside a
            two-line title. */}
        {isCompact && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.colors.borderSubtle,
              paddingTop: theme.space[3],
            }}
          >
            {actions}
          </View>
        )}
      </VStack>
    </VStack>
  );
}