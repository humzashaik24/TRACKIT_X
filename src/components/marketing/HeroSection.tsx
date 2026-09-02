/**
 * Trackit X — hero.
 *
 * The first screen. Three layers, in back-to-front order: `HeroBackdrop`, which is
 * static and always present; `LazyOrbit`, which arrives when its chunk does and is
 * allowed never to arrive at all; and the copy, which is the only layer that
 * matters and therefore the only one that is not deferred.
 *
 * ── Why the content sits low and left ──────────────────────────────────────
 * On a wide screen the visualization occupies the right half, so anchoring the
 * headline to the lower left gives the composition a diagonal instead of a centred
 * stack fighting a circle for the middle. On a phone there is no second column to
 * balance against, so the copy takes the centre and the orbit shrinks to a motif
 * above it.
 *
 * The reveal schedule — background, headline, statement, description, actions,
 * trust line — is the sequence the brief specifies, expressed as delays on
 * `Reveal`. `useEntrance` collapses all of it to a single frame when the operating
 * system asks for reduced motion.
 */
import { StyleSheet, View } from 'react-native';

import { createStyles, HStack, Text, useResponsive, useStyles, VStack } from '@/design-system';

import { HERO } from './content';
import { HeroBackdrop } from './HeroBackdrop';
import { HeroCTA } from './HeroCTA';
import { LazyOrbit } from './LazyOrbit';
import { Reveal } from './Reveal';

export interface HeroSectionProps {
  /** Into the product — the existing sign-in route. */
  onEnter: () => void;
  /** Down the page, to the explanation. */
  onSeeHow: () => void;
  /** Top safe-area inset, so the copy clears the floating navbar. */
  insetTop: number;
}

const styles = createStyles((theme) => ({
  hero: {
    width: '100%',
    // Clips the visualization where it bleeds past the right edge.
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  orbitLayer: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  orbitLayerCompact: {
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: theme.layout.maxContentWidth,
    alignSelf: 'center',
  },
  copy: {
    // Keeps the headline out from under the visualization on a wide screen, and
    // holds the description to a readable measure everywhere.
    maxWidth: 660,
  },
  description: {
    maxWidth: 560,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent.fg,
  },
}));

export function HeroSection({ onEnter, onSeeHow, insetTop }: HeroSectionProps) {
  const s = useStyles(styles);
  const { width, height, isCompact, screenPaddingX, select } = useResponsive();

  const headlineVariant = select<'heroSm' | 'hero' | 'heroLg'>({
    compact: 'heroSm',
    regular: 'hero',
    wide: 'heroLg',
  });
  const statementVariant = select<'leadSm' | 'lead'>({ compact: 'leadSm', regular: 'lead' });

  const orbitSize = Math.round(
    select({
      compact: Math.min(width * 0.86, 300),
      regular: Math.min(width * 0.52, 440),
      wide: Math.min(width * 0.44, height * 0.84, 620),
    }),
  );

  return (
    <View
      style={[
        s.hero,
        {
          // A short browser window still gets a hero worth looking at; a tall one
          // gets the full viewport the brief asks for.
          minHeight: Math.max(600, height),
          paddingHorizontal: screenPaddingX,
          paddingTop: insetTop + 96,
          paddingBottom: select({ compact: 64, regular: 88, wide: 104 }),
        },
      ]}
    >
      <HeroBackdrop />

      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          isCompact ? s.orbitLayerCompact : s.orbitLayer,
          isCompact && { paddingTop: insetTop + 72 },
        ]}
      >
        <LazyOrbit
          size={orbitSize}
          lightweight={isCompact}
          // A slight bleed past the right edge reads as a scene continuing rather
          // than an illustration placed on a slide.
          style={isCompact ? {} : { marginRight: -Math.round(orbitSize * 0.08) }}
        />
      </View>

      <View style={s.content}>
        <VStack gap={5} style={s.copy}>
          <Reveal delay={200}>
            <Text variant={headlineVariant}>{HERO.headlineTop}</Text>
            <Text variant={headlineVariant}>
              {HERO.headlineBottomPrefix}
              <Text variant={headlineVariant} tone="accent">
                {HERO.headlineAccent}
              </Text>
            </Text>
          </Reveal>

          <Reveal delay={400}>
            <Text variant={statementVariant} tone="primary">
              {HERO.statement}
            </Text>
          </Reveal>

          <Reveal delay={550}>
            <Text variant="bodyLg" tone="secondary" style={s.description}>
              {HERO.description}
            </Text>
          </Reveal>

          <Reveal delay={700}>
            <HeroCTA
              primaryLabel={HERO.primaryCta}
              secondaryLabel={HERO.secondaryCta}
              onPrimary={onEnter}
              onSecondary={onSeeHow}
            />
          </Reveal>

          <Reveal delay={850}>
            <HStack gap={2.5}>
              {/* The dot is decoration beside a sentence that already says the
                  same thing, so nothing here depends on colour alone. */}
              <View style={s.statusDot} />
              <Text variant="labelSm" tone="tertiary">
                {HERO.trust}
              </Text>
            </HStack>
          </Reveal>
        </VStack>
      </View>
    </View>
  );
}
