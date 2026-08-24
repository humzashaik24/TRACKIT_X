/**
 * Trackit X — ErrorState.
 *
 * What the user sees when something failed. The contract is deliberate:
 *
 *  · The headline is in plain language. Stack traces, SQL, and raw provider
 *    messages are never shown — they leak implementation detail and help nobody.
 *  · A retry is offered whenever the operation is retryable, and omitted when it
 *    is not, so the button never lies about being able to fix things.
 *  · A `correlationId` may be shown so support can find the matching server log.
 *    That is an opaque identifier, never the error payload itself.
 *
 * Callers pass a message they have already made safe. Passing a raw error object
 * through to this component is a security bug, not a shortcut.
 */
import { Platform, View, type ViewStyle } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { radius, space } from '../tokens';
import { Button } from './Button';
import { HStack, VStack } from './Stack';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ErrorStateKind = 'generic' | 'network' | 'permission' | 'notFound';

export interface ErrorStateProps {
  kind?: ErrorStateKind;
  title?: string;
  /** A user-safe explanation. Never a raw error or provider message. */
  message?: string;
  /** Opaque request identifier for support. Not the error payload. */
  correlationId?: string;
  onRetry?: () => void;
  retryLabel?: string;
  secondaryAction?: { label: string; onPress: () => void; icon?: IconName };
  /** Tighter treatment for use inside a card. */
  inline?: boolean;
  style?: ViewStyle;
}

interface KindCopy {
  icon: IconName;
  title: string;
  message: string;
  retryable: boolean;
}

const kindCopy: Record<ErrorStateKind, KindCopy> = {
  generic: {
    icon: 'warning',
    title: 'Something went wrong',
    message: 'We could not complete that just now. Trying again usually works.',
    retryable: true,
  },
  network: {
    icon: 'refresh',
    title: 'No connection',
    message: 'Check your network and try again. Nothing has been lost.',
    retryable: true,
  },
  permission: {
    icon: 'lock',
    title: 'You do not have access to this',
    message: 'Your role does not include this area. Ask an administrator if you need it.',
    retryable: false,
  },
  notFound: {
    icon: 'search',
    title: 'Not found',
    message: 'This record may have been removed, or the link may be out of date.',
    retryable: false,
  },
};

export function ErrorState({
  kind = 'generic',
  title,
  message,
  correlationId,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction,
  inline = false,
  style,
}: ErrorStateProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const copy = kindCopy[kind];
  const medallion = inline ? 44 : 64;
  // A retry button is only drawn when this kind of failure can actually be retried.
  const showRetry = onRetry !== undefined && copy.retryable;

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${title ?? copy.title}. ${message ?? copy.message}`}
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
          backgroundColor: theme.colors.danger.subtle,
          borderWidth: 1,
          borderColor: theme.colors.danger.border,
        }}
      >
        <Icon name={copy.icon} size={inline ? 'lg' : '2xl'} tone="danger" />
      </View>

      <VStack gap={1.5} align="center" style={{ maxWidth: 440 }}>
        <Text variant={inline ? 'h4' : 'h3'} align="center">
          {title ?? copy.title}
        </Text>
        <Text variant="bodySm" tone="secondary" align="center">
          {message ?? copy.message}
        </Text>
      </VStack>

      {(showRetry || secondaryAction !== undefined) && (
        <HStack gap={2} wrap justify="center">
          {showRetry && (
            <Button label={retryLabel} iconLeft="retry" size={inline ? 'sm' : 'md'} onPress={onRetry} />
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

      {correlationId !== undefined && (
        <View
          style={{
            paddingHorizontal: space[2.5],
            paddingVertical: space[1],
            borderRadius: radius.xs,
            backgroundColor: theme.colors.surfaceInset,
            borderWidth: 1,
            borderColor: theme.colors.borderSubtle,
            maxWidth: isCompact ? '100%' : 420,
          }}
        >
          <Text
            variant="mono"
            tone="tertiary"
            numberOfLines={1}
            // Selectable so a user can copy it into a support request.
            selectable={Platform.OS !== 'android'}
          >
            {`Reference: ${correlationId}`}
          </Text>
        </View>
      )}
    </View>
  );
}
