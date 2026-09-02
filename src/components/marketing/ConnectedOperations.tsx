/**
 * Trackit X — connected operations.
 *
 * Six domains under one band. The band is the argument: the domains are ordinary —
 * every business has projects, people, stock and cash — and what is being sold is
 * the layer that reads across them.
 *
 * Icons here are deliberately not accent-coloured. Six green glyphs in a grid would
 * spend the accent on decoration, and the accent's job on this page is to mark the
 * AI and the actions. Only the agents card, which is the AI one, keeps it.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  createStyles,
  HStack,
  Icon,
  motion,
  staggerDelay,
  Text,
  useResponsive,
  useStyles,
  useTheme,
  VStack,
  withAlpha,
} from '@/design-system';

import { CONNECTED_OPERATIONS } from './content';
import { Reveal } from './Reveal';
import { SectionShell } from './SectionShell';

const styles = createStyles((theme) => ({
  band: {
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent.border,
    paddingHorizontal: theme.space[5],
    paddingVertical: theme.space[4],
    minWidth: 0,
  },
  bandRow: {
    minWidth: 0,
  },
  bandText: {
    flex: 1,
    minWidth: 0,
  },
  mark: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent.subtle,
    borderWidth: 1,
    borderColor: theme.colors.accent.border,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 230,
  },
  card: {
    height: '100%',
  },
}));

export function ConnectedOperations() {
  const s = useStyles(styles);
  const theme = useTheme();
  const { gridGap } = useResponsive();

  return (
    <SectionShell
      divided
      eyebrow={CONNECTED_OPERATIONS.eyebrow}
      title={CONNECTED_OPERATIONS.title}
      lead={CONNECTED_OPERATIONS.lead}
    >
      <VStack gap={4} style={{ marginTop: gridGap }}>
        <Reveal>
          <View style={s.band}>
            <LinearGradient
              colors={[
                withAlpha(theme.colors.accent.fg, 0.14),
                withAlpha(theme.colors.ai.fg, 0.1),
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <HStack gap={4} style={s.bandRow}>
              <View style={s.mark}>
                <Icon name="aiBrain" size="md" tone="accent" />
              </View>
              <VStack gap={0.5} style={s.bandText}>
                <Text variant="h4">AI reasoning layer</Text>
                <Text variant="bodySm" tone="secondary">
                  Reads across every domain below, and relates them to each other.
                </Text>
              </VStack>
            </HStack>
          </View>
        </Reveal>

        <View style={[s.grid, { gap: gridGap }]}>
          {CONNECTED_OPERATIONS.domains.map((domain, index) => (
            <Reveal
              key={domain.title}
              delay={staggerDelay(index, motion.stagger.grid * 2)}
              style={s.cell}
            >
              <Card variant="glass" padding={4} corner="lg" style={s.card}>
                <VStack gap={3}>
                  <Icon
                    name={domain.icon}
                    size="lg"
                    tone={domain.icon === 'aiAgent' ? 'accent' : 'tertiary'}
                  />
                  <VStack gap={1}>
                    <Text variant="h4">{domain.title}</Text>
                    <Text variant="bodySm" tone="secondary">
                      {domain.detail}
                    </Text>
                  </VStack>
                </VStack>
              </Card>
            </Reveal>
          ))}
        </View>
      </VStack>
    </SectionShell>
  );
}
