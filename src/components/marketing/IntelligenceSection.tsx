/**
 * Trackit X — Intelligence section.
 *
 * The first thing to establish after the hero: the product's claim is about
 * *relationships*, not storage. Three cards, because three is the number a reader
 * takes in without counting.
 *
 * The grid is min-width driven — cells declare the narrowest they are willing to be
 * and Yoga decides how many fit per row. Percentage widths plus a gap overflow, and
 * a measured layout would need `onLayout` and a re-render for something the layout
 * engine can already work out.
 */
import { View } from 'react-native';

import {
  Card,
  createStyles,
  Icon,
  motion,
  staggerDelay,
  Text,
  useResponsive,
  useStyles,
  VStack,
} from '@/design-system';

import { INTELLIGENCE } from './content';
import { Reveal } from './Reveal';
import { SectionShell } from './SectionShell';

const styles = createStyles((theme) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    flexBasis: 0,
    flexGrow: 1,
    // Below this the title wraps to three lines and the card stops reading as a
    // single idea, so wrapping to a new row is the better trade.
    minWidth: 260,
  },
  card: {
    height: '100%',
  },
  mark: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent.subtle,
    borderWidth: 1,
    borderColor: theme.colors.accent.border,
  },
}));

export function IntelligenceSection() {
  const s = useStyles(styles);
  const { gridGap } = useResponsive();

  return (
    <SectionShell eyebrow={INTELLIGENCE.eyebrow} title={INTELLIGENCE.title} lead={INTELLIGENCE.lead}>
      <View style={[s.grid, { gap: gridGap, marginTop: gridGap }]}>
        {INTELLIGENCE.points.map((point, index) => (
          <Reveal
            key={point.title}
            delay={staggerDelay(index, motion.stagger.grid * 2)}
            style={s.cell}
          >
            <Card variant="glass" padding={5} corner="lg" style={s.card}>
              <VStack gap={4}>
                <View style={s.mark}>
                  <Icon name={point.icon} size="md" tone="accent" />
                </View>
                <VStack gap={2}>
                  <Text variant="h3">{point.title}</Text>
                  <Text variant="body" tone="secondary">
                    {point.detail}
                  </Text>
                </VStack>
              </VStack>
            </Card>
          </Reveal>
        ))}
      </View>
    </SectionShell>
  );
}
