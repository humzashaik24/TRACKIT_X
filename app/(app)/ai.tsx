/**
 * Trackit X — AI Copilot.
 *
 * ── What this screen is ─────────────────────────────────────────────────────────
 * A question box over one workspace's own records, and nothing else. Every figure in
 * an answer was counted from a row that exists: `askCopilot` reads the same three
 * tables the dashboard reads, hands them to the same `buildDashboardSnapshot`, and lets
 * the model describe that context. There is no second aggregation on this screen and no
 * query the model can write, so a wrong answer is a misreading of real data rather than
 * an invented figure.
 *
 * ── Why the screen says the assistant is unavailable, in this build ─────────────
 * `GATEWAY_AVAILABLE` is `false`: the Edge Function that holds the provider credential
 * is not deployed, so every question would be refused with the same sentence. Showing a
 * live composer that accepts a question and always refuses it is worse than saying so
 * before the question is typed — the user learns the state from the screen rather than
 * from a failure. The whole grounded path behind this is built and tested; what is
 * missing is the server, and the screen says exactly that.
 *
 * The availability fact is read through `getAIGatewayStatus()` rather than from
 * `GATEWAY_AVAILABLE` directly, so a screen cannot check it wrongly — the same rule the
 * Settings screen follows.
 *
 * ── Why the transcript is not stored ────────────────────────────────────────────
 * There is no conversation table and no history. An AI answer is a reading of the
 * business as it was at a moment; persisting one invites it to be quoted later as
 * though it were a record. "Clear" empties the screen, and leaving does too.
 */
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  createStyles,
  Divider,
  EmptyState,
  HStack,
  Icon,
  ScreenContainer,
  Text,
  useStyles,
  VStack,
} from '@/design-system';
import { PageHeader } from '@/components/navigation/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import { ROLE_LABELS } from '@/domain/organization';
import { CopilotComposer } from '@/features/copilot/CopilotComposer';
import { CopilotTurnView } from '@/features/copilot/CopilotTurnView';
import { useCopilot } from '@/features/copilot/useCopilot';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import { getAIGatewayStatus } from '@/services/aiProviderService';
import { COPILOT_GATEWAY_UNAVAILABLE_MESSAGE } from '@/services/copilotService';

const styles = createStyles((theme) => ({
  grow: {
    flex: 1,
    minWidth: 0,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[2],
  },
}));

/**
 * The first-run explanation.
 *
 * Written as a limit rather than a promise, because the limit is the part that is
 * true: the assistant can only speak about what the workspace has records for, and a
 * question about a person who is not in the records gets a refusal rather than a
 * guess. Stating that before the first question is what makes the refusal later
 * believable instead of looking broken.
 */
const FIRST_RUN_TITLE = 'Ask about this workspace';

const FIRST_RUN_DESCRIPTION =
  'Answers are drawn from your own employees, projects and tasks — the same records the dashboard counts. If a question needs something the workspace does not have, the answer says so instead of estimating.';

export default function AIScreen() {
  const s = useStyles(styles);
  const { role } = useOrganization();
  const { turns, isAsking, canAsk, ask, clear, suggestedQuestions } = useCopilot();

  const gateway = getAIGatewayStatus();
  const unavailableReason = gateway.available ? undefined : COPILOT_GATEWAY_UNAVAILABLE_MESSAGE;

  return (
    <ScreenContainer
      edges={['bottom']}
      maxWidth="none"
      stickyFooter={
        <CopilotComposer
          canAsk={canAsk}
          isAsking={isAsking}
          unavailableReason={unavailableReason}
          onAsk={ask}
        />
      }
    >
      <PageHeader
        title="AI Copilot"
        icon="aiCopilot"
        description="Ask a question about this workspace and get an answer grounded in your own records."
        breadcrumbs={deriveBreadcrumbs('/ai')}
        status={
          <HStack gap={2} align="center" wrap>
            {role === null ? null : (
              <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
            )}
            <Badge
              label={gateway.available ? 'Ready' : 'Not available yet'}
              intent={gateway.available ? 'success' : 'warning'}
              variant="soft"
              size="sm"
            />
          </HStack>
        }
        secondaryAction={
          turns.length === 0
            ? undefined
            : {
                label: 'Clear',
                icon: 'close',
                variant: 'ghost',
                onPress: clear,
              }
        }
      />

      {/*
       * The unavailable notice.
       *
       * Shown above the transcript rather than as an empty state, because it is a
       * statement about the build and not about this workspace: there may be a hundred
       * projects here, and none of that is why the assistant cannot answer. It says
       * which half is missing — the server — because "AI is not working" invites the
       * belief that the data is at fault, and that belief costs more to undo later.
       */}
      {unavailableReason === undefined ? null : (
        <Card variant="outline" intent="warning" padding={4}>
          <HStack gap={3} align="flex-start">
            <Icon name="info" size="md" tone="warning" />
            <VStack gap={1} style={s.grow}>
              <Text variant="label">The assistant is not running yet</Text>
              <Text variant="bodySm" tone="secondary">
                {`${unavailableReason} Everything else in Trackit X works as normal. The answers are built and tested; what is missing is the server that holds your AI provider key, which is deliberately not something a phone app can carry.`}
              </Text>
            </VStack>
          </HStack>
        </Card>
      )}

      {turns.length === 0 ? (
        <VStack gap={4}>
          <EmptyState
            inline
            icon="aiCopilot"
            title={FIRST_RUN_TITLE}
            description={FIRST_RUN_DESCRIPTION}
          />
          {/*
           * The suggestions are the four questions a delivery workspace actually gets
           * asked. They are fixed strings rather than anything read from the database,
           * so opening this screen costs no queries and the list cannot change under a
           * test. Each names its own subject, so the intent it maps to is unambiguous.
           */}
          <VStack gap={2}>
            <Text variant="labelSm" tone="tertiary" uppercase>
              Try one of these
            </Text>
            <View style={s.suggestions}>
              {suggestedQuestions.map((question) => (
                <Button
                  key={question}
                  label={question}
                  variant="outline"
                  size="sm"
                  disabled={unavailableReason !== undefined || !canAsk}
                  onPress={() => {
                    void ask(question);
                  }}
                />
              ))}
            </View>
          </VStack>
        </VStack>
      ) : (
        <>
          <Divider subtle />
          <VStack gap={5}>
            {turns.map((turn) => (
              <CopilotTurnView key={turn.id} turn={turn} />
            ))}
          </VStack>
        </>
      )}
    </ScreenContainer>
  );
}
