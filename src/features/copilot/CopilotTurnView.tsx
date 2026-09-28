/**
 * Trackit X — one Copilot turn, rendered.
 *
 * ── A turn is a question and its outcome, including having no answer ────────────
 * The refusal is the state worth designing for. "AI provider is not configured for
 * this organization" is a real outcome of asking a question, and it belongs under the
 * question that caused it — a separate error banner above the transcript leaves the
 * user looking for which of their four questions it refers to.
 *
 * ── Three things are shown that a chat UI would usually hide ────────────────────
 *
 *  1. THE DATA GAPS. Computed by the client before the request was sent, and shown
 *     here whether or not the model mentioned them. A question about a project that
 *     does not exist must visibly not have been answered about that project, or the
 *     model filling the silence with a plausible description of a project that is not
 *     there is the exact failure this feature exists to avoid.
 *  2. WHETHER THE ANSWER WAS STRUCTURED. `structured === false` means the provider did
 *     not return the agreed JSON and the summary is its raw prose. That is still an
 *     answer worth reading, but presenting it as an analysis would be a claim about
 *     its provenance that is not true.
 *  3. WHEN IT WAS ASKED. The context is a reading of the business as it stood at one
 *     moment. Without a time on it, a stale answer reads as a current one.
 *
 * ── What is deliberately absent ────────────────────────────────────────────────
 * No action button, no "apply", no accept/decline. A recommendation is rendered as
 * the sentence the model produced and nothing else, because `CopilotRecommendation` is
 * `{ text }` and this component has no way to reach a record. Adding a button here
 * without adding an execution path would be a lie about what the app can do; adding
 * both is a security change, not a UI one.
 */
import { router, type Href } from 'expo-router';
import { Pressable } from 'react-native';

import {
  Badge,
  Card,
  createStyles,
  HStack,
  Icon,
  type IconName,
  Text,
  useStyles,
  VStack,
} from '@/design-system';
import type { CopilotResponse } from '@/domain/ai/copilot';
import { COPILOT_INTENT_LABELS, copilotReferenceRoute } from '@/domain/ai/copilot';
import { formatTime } from '@/utils/format';
import { COPILOT_DATA_GAP_MESSAGES } from './contextBuilder';
import type { CopilotTurn } from './useCopilot';

const styles = createStyles((theme) => ({
  grow: {
    flex: 1,
    minWidth: 0,
  },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceInset,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
}));

/** Citation glyph per entity kind. The kind is part of the citation, not decoration. */
const ENTITY_ICONS: Readonly<Record<CopilotResponse['references'][number]['entity'], IconName>> = {
  project: 'projects',
  task: 'tasks',
  employee: 'employees',
};

/**
 * The gap codes this screen can explain.
 *
 * A code with no sentence is dropped rather than rendered: the fallback would be the
 * raw code, and a user reading `workload_not_visible_to_your_role` has learned nothing
 * except that something was withheld. The mapping is exhaustive today, and if a gap is
 * added without one, silence is the correct failure — the answer still stands, and the
 * omission is a missing explanation rather than a wrong one.
 */
function gapSentences(dataGaps: readonly string[]): readonly string[] {
  return dataGaps
    .map((gap) => COPILOT_DATA_GAP_MESSAGES[gap])
    .filter((message): message is string => typeof message === 'string');
}

function Answer({ response }: { readonly response: CopilotResponse }) {
  const s = useStyles(styles);
  const gaps = gapSentences(response.dataGaps);

  return (
    <VStack gap={3}>
      <Card variant="outline" intent="ai" padding={4}>
        <VStack gap={4}>
          <Text variant="body">{response.summary}</Text>

          {response.keyPoints.length > 0 ? (
            <VStack gap={2}>
              <Text variant="labelSm" tone="tertiary" uppercase>
                What the data shows
              </Text>
              {response.keyPoints.map((point, index) => (
                <HStack key={`point-${index}`} gap={2} align="flex-start">
                  <Icon name="check" size="sm" tone="success" />
                  <Text variant="bodySm" tone="secondary" style={s.grow}>
                    {point}
                  </Text>
                </HStack>
              ))}
            </VStack>
          ) : null}

          {response.recommendations.length > 0 ? (
            <VStack gap={2}>
              <Text variant="labelSm" tone="tertiary" uppercase>
                Worth considering
              </Text>
              {response.recommendations.map((recommendation, index) => (
                <HStack key={`recommendation-${index}`} gap={2} align="flex-start">
                  <Icon name="aiInsight" size="sm" tone="accent" />
                  <Text variant="bodySm" tone="secondary" style={s.grow}>
                    {recommendation.text}
                  </Text>
                </HStack>
              ))}
            </VStack>
          ) : null}

          {response.references.length > 0 ? (
            <VStack gap={2}>
              <Text variant="labelSm" tone="tertiary" uppercase>
                From your records
              </Text>
              {/*
               * These are records the client itself put in the request, matched back by
               * id. They are the checkable part of the answer: a reader who doubts a
               * sentence can open the project or the task. A citation therefore navigates
               * when the record has a detail screen (project, task) and stays a plain
               * label when it does not (employee — there is no employee detail screen, so
               * pointing it at the People list would not verify the citation).
               */}
              <HStack gap={2} align="center" wrap>
                {response.references.map((reference) => {
                  const route = copilotReferenceRoute(reference);
                  return route.ok ? (
                    <Pressable
                      key={`${reference.entity}-${reference.entityId}`}
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${reference.label}`}
                      onPress={() => router.push(route.path as Href)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <Badge
                        label={reference.label}
                        icon={ENTITY_ICONS[reference.entity]}
                        intent="accent"
                        variant="outline"
                        size="sm"
                      />
                    </Pressable>
                  ) : (
                    <Badge
                      key={`${reference.entity}-${reference.entityId}`}
                      label={reference.label}
                      icon={ENTITY_ICONS[reference.entity]}
                      intent="neutral"
                      variant="outline"
                      size="sm"
                    />
                  );
                })}
              </HStack>
            </VStack>
          ) : null}

          {gaps.length > 0 ? (
            <HStack gap={2} align="flex-start">
              <Icon name="info" size="sm" tone="warning" />
              <VStack gap={1} style={s.grow}>
                {gaps.map((message) => (
                  <Text key={message} variant="caption" tone="tertiary">
                    {message}
                  </Text>
                ))}
              </VStack>
            </HStack>
          ) : null}
        </VStack>
      </Card>

      {/*
       * The provenance line. What was asked, which reading it came from, and when.
       * `intentLabel` is the client's own classification, not the model's — a label the
       * model chose would let it announce that a workload question was an overview.
       */}
      <HStack gap={2} align="center" wrap>
        <Badge
          label={COPILOT_INTENT_LABELS[response.intent]}
          intent="ai"
          variant="soft"
          size="sm"
        />
        {response.structured ? null : (
          <Badge label="Unstructured reply" intent="warning" variant="soft" size="sm" />
        )}
        <Text variant="caption" tone="tertiary">
          Answered from your records as of {formatTime(response.requestedAt)}.
        </Text>
      </HStack>
    </VStack>
  );
}

export function CopilotTurnView({ turn }: { readonly turn: CopilotTurn }) {
  const s = useStyles(styles);

  return (
    <VStack gap={2} style={{ width: '100%' }}>
      <Text variant="body" tone="primary" style={s.question}>
        {turn.question}
      </Text>

      {/*
       * A refusal is rendered where the answer would be, and in warning colours rather
       * than danger: nothing has gone wrong with the business, and a red card on a
       * screen full of the user's own figures reads as a fault in the data.
       */}
      {turn.status === 'refused' ? (
        <Card variant="outline" intent="warning" padding={4}>
          <HStack gap={3} align="flex-start">
            <Icon name="warning" size="md" tone="warning" />
            <Text variant="bodySm" tone="secondary" style={s.grow}>
              {turn.error ?? 'That question could not be answered.'}
            </Text>
          </HStack>
        </Card>
      ) : null}

      {turn.status === 'pending' ? (
        <HStack gap={2} align="center">
          <Icon name="pending" size="sm" tone="tertiary" />
          <Text variant="bodySm" tone="tertiary">
            Reading your records…
          </Text>
        </HStack>
      ) : null}

      {turn.status === 'answered' && turn.response !== null ? (
        <Answer response={turn.response} />
      ) : null}

      {/*
       * `discarded` has no branch because it is not a rendered state: it is recorded
       * for the log when an answer arrives after its turn is gone, and a turn that is
       * gone is not in the list this component is handed. If a future change made one
       * reachable, it would fall through to the question alone above — which shows the
       * question and no answer, rather than an answer to a question that was never
       * asked in this workspace.
       */}
    </VStack>
  );
}
