/**
 * Trackit X — landing page.
 *
 * Composes the marketing surface and owns the two things the sections cannot own
 * themselves: where the navigation links go, and where the calls to action go.
 * Every section below is a dumb presentational component; this file is the only one
 * that knows about routing or scroll position.
 *
 * ── The anchor registry ─────────────────────────────────────────────────────
 * The navbar's labels are section anchors, not routes. Each section is wrapped in a
 * plain `View` that reports its own `y` on layout, and a link scrolls to the
 * recorded offset. That is deliberate: a nav link that does nothing is worse than
 * no nav link, and hard-coding offsets would break the moment copy reflows at a
 * different width.
 *
 * ── What this page does NOT do ──────────────────────────────────────────────
 * It issues no query. It has no organization id, no session, and no repository
 * import — the figures it shows come from `content.ts` and are labelled as samples.
 * Authentication is not reimplemented here either: both actions hand off to the
 * existing `/sign-in` and `/sign-up` routes, and the route gate above this page is
 * what decides whether a visitor should be seeing it at all.
 */
import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createStyles, useReducedMotion, useStyles } from '@/design-system';

import { AIOperatingSystemSection } from './AIOperatingSystemSection';
import { BusinessHealthPreview } from './BusinessHealthPreview';
import { ConnectedOperations } from './ConnectedOperations';
import { CopilotPreview } from './CopilotPreview';
import { FinalCTA } from './FinalCTA';
import { HeroSection } from './HeroSection';
import { IntelligenceSection } from './IntelligenceSection';
import { MarketingNavbar } from './MarketingNavbar';

const styles = createStyles((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.canvas,
  },
}));

export function LandingPage() {
  const s = useStyles(styles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const scrollRef = useRef<ScrollView>(null);
  /** Section anchor → vertical offset within the scroll content. */
  const anchors = useRef<Record<string, number>>({});

  const measure = useCallback(
    (section: string) => (event: LayoutChangeEvent) => {
      anchors.current[section] = event.nativeEvent.layout.y;
    },
    [],
  );

  const scrollToSection = useCallback(
    (section: string) => {
      const y = anchors.current[section];
      if (y === undefined) return;
      // A little above the section's own top edge, so the floating navbar is not
      // sitting on the eyebrow when the scroll settles.
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 32), animated: !reduceMotion });
    },
    [reduceMotion],
  );

  const goToSignIn = useCallback(() => router.push('/sign-in'), [router]);
  const goToSignUp = useCallback(() => router.push('/sign-up'), [router]);
  const goToAi = useCallback(() => scrollToSection('ai'), [scrollToSection]);

  return (
    <View style={s.root}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        // The hero is taller than the viewport by design; bouncing past the top of
        // a full-bleed background reveals the page behind it.
        bounces={false}
      >
        <HeroSection onEnter={goToSignIn} onSeeHow={goToAi} insetTop={insets.top} />

        <View onLayout={measure('solutions')}>
          <IntelligenceSection />
        </View>

        <View onLayout={measure('ai')}>
          <AIOperatingSystemSection />
        </View>

        <BusinessHealthPreview />

        <View onLayout={measure('resources')}>
          <CopilotPreview />
        </View>

        <View onLayout={measure('products')}>
          <ConnectedOperations />
        </View>

        <View onLayout={measure('company')}>
          <FinalCTA onEnter={goToSignIn} onStart={goToSignUp} />
        </View>
      </ScrollView>

      <MarketingNavbar
        onNavigate={scrollToSection}
        onEnter={goToSignIn}
        onSeeAi={goToAi}
        insetTop={insets.top}
      />
    </View>
  );
}
