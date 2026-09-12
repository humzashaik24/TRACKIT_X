/**
 * Trackit X — Breadcrumbs.
 *
 * Renders a trail derived from the current route. The last crumb is the page
 * itself and never links anywhere; earlier crumbs navigate. Semantics follow
 * the standard trail pattern: the container is labelled for screen readers and
 * each navigable crumb is announced as a link.
 */
import { router, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { createStyles, HStack, Icon, Text, useStyles } from '@/design-system';
import type { BreadcrumbSegment } from '@/navigation/breadcrumbs';

const styles = createStyles((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: theme.space[1],
    minWidth: 0,
  },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1],
    flexShrink: 1,
    minWidth: 0,
  },
}));

export interface BreadcrumbsProps {
  crumbs: readonly BreadcrumbSegment[];
  /** Screen-reader label for the whole trail. Defaults to the joined labels. */
  accessibilityLabel?: string;
  /** Maximum crumbs shown before collapsing the middle into the first + last. */
  maxItems?: number;
}

export function Breadcrumbs({ crumbs, accessibilityLabel, maxItems = 4 }: BreadcrumbsProps) {
  const s = useStyles(styles);

  if (crumbs.length === 0) return null;

  const shown =
    crumbs.length > maxItems
      ? [...crumbs.slice(0, 1), ...crumbs.slice(crumbs.length - maxItems + 1)]
      : crumbs;

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel ?? crumbs.map((crumb) => crumb.label).join(', ')}
      style={s.row}
    >
      {shown.map((crumb, index) => {
        const isCurrent = index === shown.length - 1;

        const body = (
          <HStack gap={1.5} align="center">
            <Icon name="chevronRight" size="sm" tone="tertiary" />
            <Text
              variant="caption"
              tone={isCurrent ? 'secondary' : 'tertiary'}
              numberOfLines={1}
            >
              {crumb.label}
            </Text>
          </HStack>
        );

        if (isCurrent || crumb.path === undefined) {
          return (
            <View key={`${crumb.label}-${index}`} style={s.crumb}>
              {body}
            </View>
          );
        }

        return (
          <Pressable
            key={`${crumb.label}-${index}`}
            onPress={() => {
              // `crumb.path` is a DestinationPath literal, which expo-router
              // types as part of `Href`; the indirection through the segment
              // interface makes the narrower type invisible here, so the cast
              // restores it.
              router.push(crumb.path as unknown as Href);
            }}
            accessibilityRole="link"
            accessibilityLabel={crumb.label}
            accessibilityHint="Goes to this page"
            hitSlop={6}
            tabIndex={0}
          >
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}