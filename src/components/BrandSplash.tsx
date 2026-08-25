/**
 * Trackit X — brand splash.
 *
 * Shown while the session and membership list resolve. Deliberately not a bare
 * spinner: this is the first thing a user sees on every cold start, and on a slow
 * connection it is on screen for a second or two.
 *
 * It states what is happening in words as well as motion, because a spinner alone
 * cannot distinguish "restoring your session" from "stuck".
 */
import { View } from 'react-native';

import { createStyles, GlassSurface, Icon, Text, useStyles, VStack } from '@/design-system';

export interface BrandSplashProps {
  /** What is being waited on. Keep it short and true. */
  label?: string;
}

const styles = createStyles((theme) => ({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.canvas,
    padding: theme.space[6],
  },
  mark: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    maxWidth: 280,
  },
}));

export function BrandSplash({ label = 'Restoring your session' }: BrandSplashProps) {
  const s = useStyles(styles);

  return (
    <View style={s.root} accessibilityRole="progressbar" accessibilityLabel={label}>
      <VStack gap={5} align="center">
        <GlassSurface corner="xl" style={s.mark}>
          <Icon name="aiSpark" size={32} tone="accent" />
        </GlassSurface>

        <VStack gap={2} align="center">
          <Text variant="h3" align="center">
            Trackit X
          </Text>
          <Text variant="bodySm" tone="secondary" align="center" style={s.caption}>
            {label}
          </Text>
        </VStack>
      </VStack>
    </View>
  );
}
