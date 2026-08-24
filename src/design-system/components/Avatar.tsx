/**
 * Trackit X — Avatar.
 *
 * Falls back from photo → initials → a generic person glyph. The initials
 * background is derived from a *stable key* (the user id, or the name if no id
 * is given), so a person keeps the same colour everywhere in the product and
 * across reloads — the same "colour follows the entity, never its position"
 * rule the chart palette uses.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { avatarSize, radius, withAlpha, type AvatarSizeToken } from '../tokens';
import { HStack } from './Stack';
import { Icon } from './Icon';
import { Text } from './Text';

export type PresenceStatus = 'online' | 'away' | 'offline' | 'busy';

export interface AvatarProps {
  /** Display name, used for initials and the accessibility label. */
  name?: string;
  uri?: string;
  size?: AvatarSizeToken;
  /** Stable identity for colour derivation. Falls back to `name`. */
  colorKey?: string;
  presence?: PresenceStatus;
  /** Renders a square-ish avatar — used for organisations, not people. */
  square?: boolean;
  style?: ViewStyle;
}

/** Up to two initials from a display name. */
export function initialsFrom(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stable, non-cryptographic hash — identical output for identical input. */
function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Font size that keeps initials optically centred at each diameter. */
const initialsScale = 0.4;

const presenceColorKey: Record<PresenceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  online: 'success',
  away: 'warning',
  busy: 'danger',
  offline: 'neutral',
};

export function Avatar({
  name,
  uri,
  size = 'md',
  colorKey,
  presence,
  square = false,
  style,
}: AvatarProps) {
  const theme = useTheme();
  const [imageFailed, setImageFailed] = useState(false);

  const dimension = avatarSize[size];
  const corner = square ? radius.md : radius.pill;
  const label = name ?? 'Unknown person';

  const identity = colorKey ?? name ?? '';
  const series = theme.chart.series;
  const tint = series[hashKey(identity) % series.length] ?? theme.colors.accent.fg;

  const showImage = uri !== undefined && uri.length > 0 && !imageFailed;

  const container: ViewStyle = {
    width: dimension,
    height: dimension,
    borderRadius: corner,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: showImage ? theme.colors.surfaceInset : withAlpha(tint, 0.22),
    borderWidth: 1,
    borderColor: showImage ? theme.colors.border : withAlpha(tint, 0.45),
  };

  const presenceDiameter = Math.max(8, Math.round(dimension * 0.28));

  return (
    <View
      style={[{ width: dimension, height: dimension }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <View style={container}>
        {showImage ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={160}
            onError={() => setImageFailed(true)}
          />
        ) : name !== undefined && name.trim().length > 0 ? (
          <Text
            color={tint}
            style={{
              fontSize: Math.round(dimension * initialsScale),
              lineHeight: Math.round(dimension * initialsScale * 1.15),
              fontWeight: '600',
              letterSpacing: 0.2,
            }}
          >
            {initialsFrom(name)}
          </Text>
        ) : (
          <Icon name="user" size={Math.round(dimension * 0.5)} tone="tertiary" />
        )}
      </View>

      {presence !== undefined && (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: presenceDiameter,
            height: presenceDiameter,
            borderRadius: radius.pill,
            backgroundColor: theme.colors[presenceColorKey[presence]].fg,
            borderWidth: 2,
            borderColor: theme.colors.surface,
          }}
        />
      )}
    </View>
  );
}

export interface AvatarGroupProps {
  people: readonly { id: string; name?: string; uri?: string }[];
  size?: AvatarSizeToken;
  /** Beyond this many, the rest collapse into a "+N" chip. */
  max?: number;
}

export function AvatarGroup({ people, size = 'sm', max = 4 }: AvatarGroupProps) {
  const theme = useTheme();
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  const dimension = avatarSize[size];

  return (
    <HStack accessibilityLabel={`${people.length} people`}>
      {shown.map((person, index) => (
        <View
          key={person.id}
          style={{
            // A 2px ring in the surface colour separates overlapping avatars —
            // the same "mark gap" rule the chart marks use.
            padding: 2,
            borderRadius: radius.pill,
            backgroundColor: theme.colors.surface,
            ...(index > 0 && { marginLeft: -dimension * 0.34 }),
          }}
        >
          <Avatar name={person.name} uri={person.uri} colorKey={person.id} size={size} />
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={{
            marginLeft: -dimension * 0.34,
            padding: 2,
            borderRadius: radius.pill,
            backgroundColor: theme.colors.surface,
          }}
        >
          <View
            style={{
              width: dimension,
              height: dimension,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.neutral.subtle,
            }}
          >
            <Text variant="labelSm" tone="secondary">{`+${overflow}`}</Text>
          </View>
        </View>
      )}
    </HStack>
  );
}
