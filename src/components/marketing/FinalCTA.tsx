/**
 * Trackit X — closing call to action.
 *
 * The last thing on the page, and the only section that is centred. Everything above
 * it is read left-to-right in a column; this one is a full stop, so it gets its own
 * axis and its own light.
 *
 * The two actions go to different places on purpose — "Enter Trackit X" to sign-in
 * for someone who already has a workspace, "Start Operating" to sign-up for someone
 * who does not. Both hand off to the existing auth routes; neither implements any
 * part of authentication here.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import {
  createStyles,
  HStack,
  Icon,
  Text,
  useResponsive,
  useStyles,
  useTheme,
  VStack,
  withAlpha,
} from '@/design-system';

import { FINAL_CTA } from './content';
import { HeroCTA } from './HeroCTA';
import { Reveal } from './Reveal';

export interface FinalCTAProps {
  /** Existing workspace — the sign-in route. */
  onEnter: () => void;
  /** New workspace — the sign-up route. */
  onStart: () => void;
}

const styles = createStyles((theme) => ({
  section: {
    width: '100%',
    alignItems: 'center',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
  column: {
    width: '100%',
    maxWidth: 820,
    alignItems: 'center',
  },
  footnote: {
    minWidth: 0,
  },
  spaced: {
    marginTop: theme.space[8],
  },
}));

export function FinalCTA({ onEnter, onStart }: FinalCTAProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const { screenPaddingX, select } = useResponsive();

  const titleVariant = select<'heroSm' | 'hero'>({ compact: 'heroSm', regular: 'hero' });
  const leadVariant = select<'leadSm' | 'lead'>({ compact: 'leadSm', regular: 'lead' });

  return (
    <View
      style={[
        s.section,
        {
          paddingHorizontal: screenPaddingX,
          paddingVertical: select({ compact: 80, regular: 112, wide: 144 }),
        },
      ]}
    >
      {/* Light rising from the bottom of the page rather than falling onto it —
          the hero's light comes from above, so the two ends are not identical. */}
      <LinearGradient
        colors={[withAlpha(theme.colors.accent.fg, 0), withAlpha(theme.colors.accent.fg, 0.1)]}
        style={StyleSheet.absoluteFill}
      />

      <View style={s.column}>
        <Reveal>
          <VStack gap={5} style={s.column}>
            <VStack gap={0} style={s.column}>
              {/* Neither line is green. The accent is spent on the button below —
                  a headline this size in the accent would be the flood the brand
                  direction warns against, and the payoff is the action anyway. */}
              <Text variant={titleVariant} align="center" tone="secondary">
                {FINAL_CTA.titleTop}
              </Text>
              <Text variant={titleVariant} align="center">
                {FINAL_CTA.titleBottom}
              </Text>
            </VStack>

            <Text variant={leadVariant} tone="secondary" align="center">
              {FINAL_CTA.lead}
            </Text>
          </VStack>
        </Reveal>

        <Reveal delay={140} style={s.spaced}>
          <HeroCTA
            primaryLabel={FINAL_CTA.primaryCta}
            secondaryLabel={FINAL_CTA.secondaryCta}
            onPrimary={onEnter}
            onSecondary={onStart}
          />
        </Reveal>

        <Reveal delay={260} style={s.spaced}>
          <HStack gap={2} style={s.footnote}>
            <Icon name="shield" size="xs" tone="tertiary" />
            <Text variant="caption" tone="tertiary">
              {FINAL_CTA.footnote}
            </Text>
          </HStack>
        </Reveal>
      </View>
    </View>
  );
}
