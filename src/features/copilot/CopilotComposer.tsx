/**
 * Trackit X — the Copilot question composer.
 *
 * ── One question in flight, and why the input locks ─────────────────────────────
 * `useCopilot` resolves one question at a time, so the input disables itself while one
 * is outstanding. That is a correctness property wearing a UX costume: two concurrent
 * questions would race on the same organization's snapshot, and the two answers would
 * be about two moments while sitting next to each other in one transcript, implying a
 * single reading of the business that never existed.
 *
 * ── The placeholder says what the assistant knows ───────────────────────────────
 * Not "Ask anything". The answer is grounded in this workspace's own records, and a
 * prompt that suggests otherwise is the first of the small lies that make the tenth
 * one plausible. The send button is disabled on empty input for the same reason: a
 * button that does nothing is worse than one that is visibly not available.
 *
 * ── Nothing is sent from here ───────────────────────────────────────────────────
 * This component holds the text and calls `onAsk`. It performs no read, builds no
 * context and decides nothing about what may be sent — `askCopilot` owns all of that,
 * including the refusal to send an empty or over-long question. A second implementation
 * of those rules in the view is a second thing to keep in step with them.
 */
import { useCallback, useState } from 'react';

import { Button, createStyles, HStack, Input, Text, useStyles, VStack } from '@/design-system';

const styles = createStyles((theme) => ({
  composer: {
    paddingTop: theme.space[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
}));

export interface CopilotComposerProps {
  /** False with no organization, or while a question is in flight. */
  readonly canAsk: boolean;
  readonly isAsking: boolean;
  /**
   * Set when the assistant cannot run at all in this build, with the sentence to show
   * in place of the input. Distinct from `canAsk`, which is about this moment rather
   * than about the build.
   */
  readonly unavailableReason?: string | undefined;
  onAsk(question: string): Promise<void>;
}

export function CopilotComposer({
  canAsk,
  isAsking,
  unavailableReason,
  onAsk,
}: CopilotComposerProps) {
  const s = useStyles(styles);
  const [question, setQuestion] = useState('');

  const trimmed = question.trim();
  const disabled = unavailableReason !== undefined || !canAsk || trimmed.length === 0;

  const submit = useCallback((): void => {
    if (disabled) return;
    // Cleared optimistically: the question is already in the transcript as a turn, and
    // leaving it in the box invites a second, identical question. A refusal clears it
    // too — the turn carries the question and the reason, which is where a retry starts.
    setQuestion('');
    void onAsk(trimmed);
  }, [disabled, onAsk, trimmed]);

  if (unavailableReason !== undefined) {
    return (
      <VStack gap={2} style={s.composer}>
        <Text variant="bodySm" tone="secondary">
          {unavailableReason}
        </Text>
      </VStack>
    );
  }

  return (
    <VStack gap={2} style={s.composer}>
      <HStack gap={2} align="flex-end">
        <VStack gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask about your projects, tasks or people"
            multiline
            numberOfLines={2}
            // Enter sends on web, where a chat box that needs a separate click is
            // unfamiliar. Shift+Enter still inserts a newline, which is what makes a
            // multi-line question possible at all.
            blurOnSubmit={false}
            onSubmitEditing={submit}
            maxLength={1000}
            editable={!isAsking}
            accessibilityLabel="Ask the Copilot a question about this workspace"
          />
        </VStack>
        <Button
          label="Ask"
          iconLeft="send"
          intent="ai"
          onPress={submit}
          disabled={disabled}
          loading={isAsking}
          accessibilityLabel="Ask the Copilot"
        />
      </HStack>
      {/*
       * The character counter only appears once the limit is in reach, because a
       * permanent "0 / 1000" is noise on a box that is empty almost all of the time.
       */}
      {question.length > 800 ? (
        <Text variant="caption" tone="tertiary" align="right">
          {question.length} / 1000
        </Text>
      ) : null}
    </VStack>
  );
}
