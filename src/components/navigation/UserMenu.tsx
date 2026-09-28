/**
 * Trackit X — UserMenu.
 *
 * The signed-in user's identity and account actions. Reads display information
 * from `useAuth()` — the session, never anything the app invented — and signs
 * out through the SAME `AuthContext.signOut` the rest of the app uses, so the
 * logout path stays in one place. On failure the session is still live, so the
 * menu stays open and says so rather than pretending the sign-out happened.
 */
import { router, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Avatar,
  Button,
  Divider,
  HStack,
  Icon,
  Text,
  useResponsive,
  useTheme,
  useToast,
  VStack,
} from '@/design-system';
import { useAuth } from '@/contexts/AuthContext';

import { HeaderPopover } from './HeaderPopover';

export function UserMenu() {
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const { displayName, user, signOut } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const email = user?.email ?? '';

  const handleSignOut = useCallback(async (): Promise<void> => {
    setSigningOut(true);
    const result = await signOut();
    if (!result.ok) {
      // The route gate navigates when the session actually ends; if sign-out
      // failed the session is still live, so stay here and say so.
      setSigningOut(false);
      toast.show({
        title: 'Could not sign out',
        message: result.error.userMessage,
        intent: 'danger',
      });
    }
  }, [signOut, toast]);

  const navigate = useCallback((href: string) => {
    setOpen(false);
    router.push(href as unknown as Href);
  }, []);

  return (
    <>
      <Pressable
        onPress={() => setOpen((previous) => !previous)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Account menu. Signed in as ${displayName}`}
        tabIndex={0}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          paddingHorizontal: theme.space[2],
          paddingVertical: theme.space[1],
          borderRadius: theme.radius.pill,
          backgroundColor: pressed ? theme.colors.surfaceHover : 'transparent',
        })}
      >
        <Avatar name={displayName} size="md" colorKey={user?.id} />
        {!isCompact && (
          <>
            <Text variant="label" numberOfLines={1} style={{ maxWidth: 140 }}>
              {displayName}
            </Text>
            <Icon name="chevronDown" size="sm" tone="tertiary" />
          </>
        )}
      </Pressable>

      {open && (
        <HeaderPopover onClose={() => setOpen(false)} width={300}>
          <HStack gap={3} align="center" style={{ padding: theme.space[4] }}>
            <Avatar name={displayName} size="lg" colorKey={user?.id} />
            <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
              <Text variant="h4" numberOfLines={1}>
                {displayName}
              </Text>
              {email.length > 0 && (
                <Text variant="caption" tone="tertiary" numberOfLines={1}>
                  {email}
                </Text>
              )}
            </VStack>
          </HStack>
          <Divider subtle />

          <View style={{ padding: theme.space[2] }}>
            <MenuRow
              icon="user"
              label="More"
              onPress={() => navigate('/more')}
            />
            <MenuRow
              icon="settings"
              label="Settings"
              onPress={() => navigate('/settings')}
            />
          </View>

          <Divider subtle />

          <View style={{ padding: theme.space[3] }}>
            <Button
              label="Sign out"
              variant="outline"
              intent="danger"
              iconLeft="logout"
              loading={signingOut}
              fullWidth
              accessibilityLabel={`Sign out ${displayName}`}
              onPress={() => {
                void handleSignOut();
              }}
            />
          </View>
        </HeaderPopover>
      )}
    </>
  );
}

function MenuRow({ icon, label, onPress }: { icon: 'user' | 'settings'; label: string; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      tabIndex={0}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.md,
        backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceHover,
      })}
    >
      <Icon name={icon} size="md" tone="secondary" />
      <Text variant="body">{label}</Text>
    </Pressable>
  );
}