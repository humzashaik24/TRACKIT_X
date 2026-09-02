/**
 * Trackit X — section frame.
 *
 * Every section below the hero opens the same way: a small accent eyebrow, a large
 * title, one paragraph of lead, then whatever that section is actually showing. The
 * frame is here so the six of them share one rhythm — gutters, maximum measure,
 * vertical breathing room and reveal timing are decided once.
 *
 * ── Why the lead has its own narrower measure ───────────────────────────────
 * The content below a header wants the full column, but a paragraph set to 1520px
 * is unreadable — the eye loses the line on the return sweep. So the header column
 * is capped near a comfortable measure while the section body is not.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { createStyles, Text, useResponsive, useStyles, VStack } from '@/design-system';

import { Reveal } from './Reveal';

export interface SectionShellProps {
  eyebrow: string;
  title: string;
  lead: string;
  /** What the section shows. Revealed after the header. */
  children?: ReactNode;
  /** Draws a hairline above the section, separating it from the one before. */
  divided?: boolean;
}

const styles = createStyles((theme) => ({
  section: {
    width: '100%',
    alignItems: 'center',
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
  column: {
    width: '100%',
    maxWidth: theme.layout.maxContentWidth,
  },
  header: {
    // Roughly 70 characters at the lead size — the width a paragraph stays
    // readable at, independent of how wide the section itself is allowed to be.
    maxWidth: 760,
  },
}));

export function SectionShell({ eyebrow, title, lead, children, divided = false }: SectionShellProps) {
  const s = useStyles(styles);
  const { screenPaddingX, select } = useResponsive();

  const titleVariant = select<'display' | 'displayLg'>({
    compact: 'display',
    regular: 'displayLg',
  });
  const leadVariant = select<'leadSm' | 'lead'>({ compact: 'leadSm', regular: 'lead' });
  const paddingVertical = select({ compact: 72, regular: 104, wide: 136 });

  return (
    <View
      style={[s.section, divided && s.divided, { paddingHorizontal: screenPaddingX, paddingVertical }]}
    >
      <View style={s.column}>
        <Reveal>
          <VStack gap={4} style={s.header}>
            <Text variant="overline" tone="accent">
              {eyebrow}
            </Text>
            <Text variant={titleVariant}>{title}</Text>
            <Text variant={leadVariant} tone="secondary">
              {lead}
            </Text>
          </VStack>
        </Reveal>

        {children === undefined ? null : <Reveal delay={140}>{children}</Reveal>}
      </View>
    </View>
  );
}
