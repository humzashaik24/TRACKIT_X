/**
 * Trackit X — business health preview.
 *
 * ⚠ Every figure on this surface is invented, and it is labelled as invented in the
 * UI — a badge above the panel, and a caption inside it. The product's rule is that
 * an owner must never be shown a fabricated number as their own; on a public page
 * with no session the safeguard is that the illustration must be unmistakably an
 * illustration. The values live in `content.ts`, not here.
 *
 * The score sits beside its own breakdown rather than above it, because the point
 * being made is that the number decomposes. A score on its own is the thing this
 * section is arguing against.
 */
import { View } from 'react-native';

import {
  Badge,
  Card,
  createStyles,
  HStack,
  motion,
  ProgressBar,
  staggerDelay,
  Text,
  useResponsive,
  useStyles,
  VStack,
} from '@/design-system';

import { BUSINESS_HEALTH } from './content';
import { Reveal } from './Reveal';
import { SectionShell } from './SectionShell';

const styles = createStyles(() => ({
  panels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  scoreCell: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 260,
  },
  metricsCell: {
    flexBasis: 0,
    // Twice the score panel's share of a wide row: four rows of detail need the
    // room, and the score itself is one large number.
    flexGrow: 2,
    minWidth: 300,
  },
  fill: {
    height: '100%',
  },
  scoreRow: {
    alignItems: 'flex-end',
  },
  metricRow: {
    // A row inside a column parent does not shrink by default in React Native, so
    // the note beside a long label would push the value off the edge without this.
    minWidth: 0,
  },
}));

export function BusinessHealthPreview() {
  const s = useStyles(styles);
  const { gridGap, select } = useResponsive();

  const scoreVariant = select<'hero' | 'heroLg'>({ compact: 'hero', wide: 'heroLg' });
  // The bar mirrors the number, which is already written out beside it — colour and
  // length are never the only carrier of the value.
  const scoreLevel = Number(BUSINESS_HEALTH.score) / 100;

  return (
    <SectionShell
      divided
      eyebrow={BUSINESS_HEALTH.eyebrow}
      title={BUSINESS_HEALTH.title}
      lead={BUSINESS_HEALTH.lead}
    >
      <VStack gap={5} style={{ marginTop: gridGap }}>
        <View>
          <Badge
            label={BUSINESS_HEALTH.sampleLabel}
            intent="neutral"
            variant="outline"
            size="sm"
            icon="info"
          />
        </View>

        <View style={[s.panels, { gap: gridGap }]}>
          <Reveal style={s.scoreCell}>
            <Card variant="glass" padding={5} corner="lg" style={s.fill}>
              <VStack gap={4}>
                <Text variant="overline" tone="tertiary">
                  Business health score
                </Text>
                <HStack gap={2} style={s.scoreRow}>
                  <Text variant={scoreVariant} tone="accent">
                    {BUSINESS_HEALTH.score}
                  </Text>
                  <Text variant="h3" tone="tertiary">
                    / 100
                  </Text>
                </HStack>
                <HStack>
                  <ProgressBar
                    value={scoreLevel}
                    intent="accent"
                    thickness={8}
                    label="Sample business health score"
                  />
                </HStack>
                <Text variant="body" tone="secondary">
                  {BUSINESS_HEALTH.scoreCaption}
                </Text>
              </VStack>
            </Card>
          </Reveal>

          <Reveal delay={motion.stagger.grid * 2} style={s.metricsCell}>
            <Card variant="glass" padding={5} corner="lg" style={s.fill}>
              <VStack gap={5}>
                {BUSINESS_HEALTH.metrics.map((metric, index) => (
                  <Reveal
                    key={metric.label}
                    delay={120 + staggerDelay(index, motion.stagger.list)}
                    distance={10}
                  >
                    <VStack gap={2}>
                      <HStack justify="space-between" gap={3} style={s.metricRow}>
                        <Text variant="h4">{metric.label}</Text>
                        <Text variant="labelSm" tone={metric.tone}>
                          {metric.value}
                        </Text>
                      </HStack>
                      <HStack>
                        <ProgressBar
                          value={metric.level}
                          intent={metric.tone}
                          thickness={5}
                          label={`${metric.label}: ${metric.value}`}
                        />
                      </HStack>
                      <Text variant="caption" tone="tertiary">
                        {metric.note}
                      </Text>
                    </VStack>
                  </Reveal>
                ))}
              </VStack>
            </Card>
          </Reveal>
        </View>
      </VStack>
    </SectionShell>
  );
}
