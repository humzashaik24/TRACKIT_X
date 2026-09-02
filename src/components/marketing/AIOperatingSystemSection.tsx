/**
 * Trackit X — the AI operating system.
 *
 * Five stages in order, presented as a segmented rule rather than a row of cards.
 * The loop is the idea here — observe, understand, predict, recommend, automate —
 * and boxing each stage would make them look like five separate features.
 *
 * ── Why the connector is per-cell and not one line ──────────────────────────
 * The stages wrap at narrow widths. A single absolutely-positioned rule across the
 * row would either be cut off or float over the second row once that happens. Each
 * cell carrying its own hairline segment produces a continuous rule when they sit on
 * one line and a correct one when they do not, with no measurement.
 */
import { View } from 'react-native';

import {
  createStyles,
  HStack,
  Icon,
  motion,
  staggerDelay,
  Text,
  useResponsive,
  useStyles,
  VStack,
} from '@/design-system';

import { OPERATING_SYSTEM } from './content';
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
    minWidth: 190,
  },
  rule: {
    height: 1,
    width: '100%',
    backgroundColor: theme.colors.borderSubtle,
  },
  dot: {
    position: 'absolute',
    left: 0,
    top: -3,
    width: 7,
    height: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent.fg,
  },
  body: {
    paddingTop: theme.space[4],
    paddingRight: theme.space[4],
  },
}));

export function AIOperatingSystemSection() {
  const s = useStyles(styles);
  const { gridGap } = useResponsive();

  return (
    <SectionShell
      divided
      eyebrow={OPERATING_SYSTEM.eyebrow}
      title={OPERATING_SYSTEM.title}
      lead={OPERATING_SYSTEM.lead}
    >
      <View style={[s.grid, { columnGap: gridGap, rowGap: gridGap, marginTop: gridGap * 1.5 }]}>
        {OPERATING_SYSTEM.stages.map((stage, index) => (
          <Reveal
            key={stage.step}
            delay={staggerDelay(index, motion.stagger.grid * 2)}
            style={s.cell}
          >
            <View style={s.rule}>
              <View style={s.dot} />
            </View>
            <VStack gap={2.5} style={s.body}>
              <HStack gap={2}>
                <Icon name={stage.icon} size="sm" tone="accent" />
                <Text variant="overline" tone="tertiary">
                  {stage.step}
                </Text>
              </HStack>
              <Text variant="h3">{stage.title}</Text>
              <Text variant="bodySm" tone="secondary">
                {stage.detail}
              </Text>
            </VStack>
          </Reveal>
        ))}
      </View>
    </SectionShell>
  );
}
