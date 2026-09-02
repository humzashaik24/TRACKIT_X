/**
 * Trackit X — copilot preview.
 *
 * Two halves: the questions an owner actually asks, and one worked example of what
 * an answer looks like. The example carries its basis line — the records the answer
 * was drawn from — because that is the difference between this and a chatbot, and
 * showing the answer without it would be selling the wrong thing.
 *
 * The question rows are deliberately not pressable. They illustrate; there is
 * nothing behind them on a public page, and a row that looks like a button but does
 * nothing is worse than a row that looks like a quotation.
 */
import { View } from 'react-native';

import {
  Badge,
  Card,
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

import { COPILOT } from './content';
import { Reveal } from './Reveal';
import { SectionShell } from './SectionShell';

const styles = createStyles((theme) => ({
  panels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  questionsCell: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 280,
  },
  exampleCell: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 300,
  },
  fill: {
    height: '100%',
  },
  questionRow: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.accent.border,
    paddingLeft: theme.space[4],
    paddingVertical: theme.space[1],
    minWidth: 0,
  },
  speaker: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  speakerAi: {
    backgroundColor: theme.colors.accent.subtle,
    borderColor: theme.colors.accent.border,
  },
  exchangeRow: {
    // The bubble text must be free to wrap; without this the row keeps its
    // intrinsic width and overflows the card.
    minWidth: 0,
    alignItems: 'flex-start',
  },
  bubble: {
    flex: 1,
    minWidth: 0,
  },
  basis: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
    paddingTop: theme.space[3],
    minWidth: 0,
  },
}));

export function CopilotPreview() {
  const s = useStyles(styles);
  const { gridGap } = useResponsive();

  return (
    <SectionShell divided eyebrow={COPILOT.eyebrow} title={COPILOT.title} lead={COPILOT.lead}>
      <View style={[s.panels, { gap: gridGap, marginTop: gridGap }]}>
        <Reveal style={s.questionsCell}>
          <VStack gap={5}>
            <Text variant="overline" tone="tertiary">
              What people ask it
            </Text>
            {COPILOT.questions.map((question, index) => (
              <Reveal
                key={question}
                delay={staggerDelay(index, motion.stagger.list)}
                distance={10}
                style={s.questionRow}
              >
                <Text variant="lead" tone="primary">
                  {question}
                </Text>
              </Reveal>
            ))}
          </VStack>
        </Reveal>

        <Reveal delay={motion.stagger.grid * 2} style={s.exampleCell}>
          <Card variant="glass" padding={5} corner="lg" style={s.fill}>
            <VStack gap={4}>
              <Badge label="Example answer" intent="ai" variant="soft" size="sm" withIcon />

              <HStack gap={3} style={s.exchangeRow}>
                <View style={s.speaker}>
                  <Icon name="aiCopilot" size="sm" tone="secondary" />
                </View>
                <View style={s.bubble}>
                  <Text variant="h4">{COPILOT.exampleQuestion}</Text>
                </View>
              </HStack>

              <HStack gap={3} style={s.exchangeRow}>
                <View style={[s.speaker, s.speakerAi]}>
                  <Icon name="aiBrain" size="sm" tone="accent" />
                </View>
                <View style={s.bubble}>
                  <Text variant="body" tone="secondary">
                    {COPILOT.exampleAnswer}
                  </Text>
                </View>
              </HStack>

              <HStack gap={2} style={s.basis}>
                <Icon name="database" size="xs" tone="tertiary" />
                <Text variant="caption" tone="tertiary" style={s.bubble}>
                  {COPILOT.exampleBasis}
                </Text>
              </HStack>
            </VStack>
          </Card>
        </Reveal>
      </View>
    </SectionShell>
  );
}
