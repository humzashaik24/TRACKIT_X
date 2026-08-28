/**
 * Trackit X — wordmark.
 *
 * The product's name, set once. `TRACKIT X` is drawn as type rather than an image
 * so it stays crisp at every density and inherits the theme's ink, and the mark
 * beside it reuses the same accent-tinted square the auth screen wears — the two
 * surfaces are the same product, entered from different doors.
 */
import { View } from 'react-native';

import { createStyles, HStack, Icon, Text, useStyles, VStack } from '@/design-system';

import { BRAND } from './content';

export interface WordmarkProps {
  /** Draws `AI BUSINESS OPERATING SYSTEM` under the name. */
  withSubtitle?: boolean;
  /** Larger treatment for the closing section and the auth frame. */
  large?: boolean;
}

const styles = createStyles((theme) => ({
  mark: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent.subtle,
    borderWidth: 1,
    borderColor: theme.colors.accent.border,
  },
  markLarge: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
  },
  name: {
    // The wordmark is the one place a wider letterspacing is deliberate: it reads
    // as a mark rather than as a heading that happens to be in capitals.
    letterSpacing: 1.6,
  },
}));

export function Wordmark({ withSubtitle = false, large = false }: WordmarkProps) {
  const s = useStyles(styles);

  return (
    <HStack gap={2.5}>
      <View style={[s.mark, large && s.markLarge]}>
        <Icon name="aiSpark" size={large ? 'lg' : 'md'} tone="accent" />
      </View>
      <VStack gap={0}>
        <Text variant={large ? 'h2' : 'h4'} style={s.name}>
          {BRAND.wordmark}
        </Text>
        {withSubtitle && (
          <Text variant="overline" tone="tertiary">
            {BRAND.subtitle}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}
