/**
 * Trackit X — EmptyState.
 *
 * An empty screen is a design decision, not an absence of one. Every empty state
 * answers three questions: what would be here, why it is not, and what to do
 * next. A state with no action is only acceptable when there genuinely is nothing
 * the user can do.
 *
 * `variant` distinguishes the three cases that need different words: a module
 * with no records yet, a filter or search that matched nothing, and a permission
 * boundary. Conflating them is why products tell people to "create your first
 * task" when the real problem is an active filter.
 */
import { View, type ViewStyle } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { radius, space } from '../tokens';
import { Button } from './Button';
import { HStack, VStack } from './Stack';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type EmptyStateVariant = 'firstRun' | 'noResults' | 'restricted';

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
}

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  /** Overrides the variant's default glyph. */
  icon?: IconName;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** Tighter treatment for use inside a card rather than a whole screen. */
  inline?: boolean;
  style?: ViewStyle;
}

const variantIcon: Record<EmptyStateVariant, IconName> = {
  firstRun: 'empty',
  noResults: 'search',
  restricted: 'lock',
};

export function EmptyState({
  variant = 'firstRun',
  icon,
  title,
  description,
  action,
  secondaryAction,
  inline = false,
  style,
}: EmptyStateProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const glyph = icon ?? variantIcon[variant];
  const medallion = inline ? 44 : 64;

  return (
    <View
      accessible
      accessibilityLabel={description === undefined ? title : `${title}. ${description}`}
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          gap: inline ? space[3] : space[4],
          paddingVertical: inline ? space[6] : space[10],
          paddingHorizontal: space[5],
        },
        style,
      ]}
    >
      <View
        style={{
          width: medallion,
          height: medallion,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.neutral.subtle,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
        }}
      >
        <Icon name={glyph} size={inline ? 'lg' : '2xl'} tone="tertiary" />
      </View>

      <VStack gap={1.5} align="center" style={{ maxWidth: 420 }}>
        <Text variant={inline ? 'h4' : 'h3'} align="center">
          {title}
        </Text>
        {description !== undefined && (
          <Text variant="bodySm" tone="secondary" align="center">
            {description}
          </Text>
        )}
      </VStack>

      {(action !== undefined || secondaryAction !== undefined) && (
        <HStack gap={2} wrap justify="center" style={isCompact ? { alignSelf: 'stretch' } : undefined}>
          {action !== undefined && (
            <Button
              label={action.label}
              iconLeft={action.icon}
              size={inline ? 'sm' : 'md'}
              onPress={action.onPress}
              fullWidth={isCompact && secondaryAction === undefined}
            />
          )}
          {secondaryAction !== undefined && (
            <Button
              label={secondaryAction.label}
              iconLeft={secondaryAction.icon}
              variant="ghost"
              size={inline ? 'sm' : 'md'}
              onPress={secondaryAction.onPress}
            />
          )}
        </HStack>
      )}
    </View>
  );
}
