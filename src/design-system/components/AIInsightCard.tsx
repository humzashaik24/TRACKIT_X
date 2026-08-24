/**
 * Trackit X — AIInsightCard.
 *
 * The container for anything the AI layer says. Every AI-produced statement in
 * the product renders through this component, which is what makes the following
 * guarantees enforceable rather than aspirational:
 *
 *  · IT IS ALWAYS MARKED AS AI. A visible badge, not a subtle tint. A reader must
 *    never have to guess whether a sentence came from a person, a query, or a
 *    model.
 *  · CONFIDENCE IS REQUIRED, NOT OPTIONAL. There is no way to render an insight
 *    without stating how sure the system is. An unqualified machine assertion is
 *    the failure mode this component exists to prevent.
 *  · THE BASIS IS SHOWABLE. `dataBasis` ("240 tasks · 90 days") and `reasoning`
 *    let a sceptical user check the claim instead of trusting it. Reasoning is
 *    collapsed by default so it informs without shouting.
 *  · NOTHING HERE ASSERTS CERTAINTY. There is no built-in copy like "we found"
 *    or "this will". The component supplies structure; the wording is the
 *    caller's, and the confidence tier is always beside it.
 *
 * `Apply` is a suggestion the user accepts, never an action the AI has already
 * taken. The card cannot perform anything itself — it calls back, and the caller
 * runs the same permission-checked path a manual action would.
 */
import { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Divider } from './Divider';
import { Icon, type IconName } from './Icon';
import { ProgressBar } from './ProgressBar';
import { HStack, VStack } from './Stack';
import { Text } from './Text';

/**
 * Confidence bands. Three, because a percentage invites false precision: a model
 * reporting 0.63 does not mean 63% of such statements are true.
 */
export type ConfidenceTier = 'low' | 'moderate' | 'high';

const CONFIDENCE_CUTS = { moderate: 0.5, high: 0.75 } as const;

/**
 * Buckets a 0–1 confidence.
 *
 * Non-finite input lands in `low` rather than throwing: an insight with a broken
 * confidence value must still render, and it must render as least-trustworthy.
 */
export function confidenceTier(confidence: number): ConfidenceTier {
  if (!Number.isFinite(confidence)) return 'low';
  if (confidence >= CONFIDENCE_CUTS.high) return 'high';
  if (confidence >= CONFIDENCE_CUTS.moderate) return 'moderate';
  return 'low';
}

const tierLabel: Record<ConfidenceTier, string> = {
  low: 'Low confidence',
  moderate: 'Moderate confidence',
  high: 'High confidence',
};

const tierIntent: Record<ConfidenceTier, 'warning' | 'info' | 'success'> = {
  low: 'warning',
  moderate: 'info',
  high: 'success',
};

/** What kind of statement this is. Changes the icon and the badge wording only. */
export type InsightKind = 'insight' | 'recommendation' | 'risk' | 'forecast' | 'explanation';

const kindIcon: Record<InsightKind, IconName> = {
  insight: 'aiInsight',
  recommendation: 'aiSpark',
  risk: 'riskAlert',
  forecast: 'simulation',
  explanation: 'aiBrain',
};

const kindBadge: Record<InsightKind, string> = {
  insight: 'AI insight',
  recommendation: 'AI recommendation',
  risk: 'AI risk signal',
  forecast: 'AI forecast',
  explanation: 'AI explanation',
};

export interface AIInsightCardProps {
  /** The claim, in the caller's words. One line where possible. */
  title: string;
  /** The elaboration. Kept short — a paragraph is not read on a dashboard. */
  body?: string;
  /**
   * How sure the system is, 0–1. REQUIRED: an insight cannot be rendered without
   * it. Clamped, so an out-of-range value degrades rather than breaking layout.
   */
  confidence: number;
  kind?: InsightKind;
  /**
   * What the claim was computed from, e.g. `'240 tasks · 90 days'`. Strongly
   * recommended: it is the difference between a claim and an unfalsifiable one.
   */
  dataBasis?: string;
  /** Why the system reached this conclusion. Collapsed until asked for. */
  reasoning?: string;
  /** Accepts the suggestion. The caller performs the permission-checked action. */
  onApply?: () => void;
  applyLabel?: string;
  /** Opens a fuller explanation — the Copilot, a drill-down, a source. */
  onExplain?: () => void;
  /** Records that this was not useful. Feedback, not just a close button. */
  onDismiss?: () => void;
  /** Disables Apply while the caller's action is in flight. */
  applying?: boolean;
  style?: ViewStyle;
}

/** Keeps a confidence value inside 0–1 without letting NaN through as a width. */
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function AIInsightCard({
  title,
  body,
  confidence,
  kind = 'insight',
  dataBasis,
  reasoning,
  onApply,
  applyLabel = 'Apply',
  onExplain,
  onDismiss,
  applying = false,
  style,
}: AIInsightCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const safeConfidence = clampConfidence(confidence);
  const tier = confidenceTier(safeConfidence);

  const hasActions = onApply !== undefined || onExplain !== undefined || onDismiss !== undefined;

  return (
    <Card variant="glass" intent="ai" accentEdge style={style}>
      <VStack gap={4}>
        <HStack gap={2} justify="space-between" align="flex-start">
          <HStack gap={2} align="center" style={{ flex: 1 }}>
            <View
              style={{
                width: theme.controlHeight.sm,
                height: theme.controlHeight.sm,
                borderRadius: theme.radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.ai.surface,
                borderWidth: 1,
                borderColor: theme.colors.ai.border,
              }}
            >
              <Icon name={kindIcon[kind]} size="md" color={theme.colors.ai.fg} />
            </View>
            {/* The provenance marker. Never conditional. */}
            <Badge label={kindBadge[kind]} intent="ai" variant="soft" size="sm" withIcon />
          </HStack>
          {onDismiss === undefined ? null : (
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this insight"
              hitSlop={8}
            >
              <Icon name="close" size="md" tone="tertiary" />
            </Pressable>
          )}
        </HStack>

        <VStack gap={1}>
          <Text variant="h4" tone="primary">
            {title}
          </Text>
          {body === undefined ? null : (
            <Text variant="body" tone="secondary">
              {body}
            </Text>
          )}
        </VStack>

        {/* Confidence is part of the statement, not a footnote to it. */}
        <VStack gap={1}>
          <ProgressBar
            value={safeConfidence}
            intent={tierIntent[tier]}
            thickness={4}
            label={tierLabel[tier]}
            showValue
          />
          {dataBasis === undefined ? null : (
            <HStack gap={1} align="center">
              <Icon name="database" size="xs" tone="tertiary" />
              <Text variant="caption" tone="tertiary">
                Based on {dataBasis}
              </Text>
            </HStack>
          )}
        </VStack>

        {reasoning === undefined ? null : (
          <VStack gap={1}>
            <Pressable
              onPress={() => {
                setExpanded((previous) => !previous);
              }}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Hide reasoning' : 'Show reasoning'}
              accessibilityState={{ expanded }}
              hitSlop={6}
            >
              <HStack gap={1} align="center">
                <Icon
                  name={expanded ? 'chevronUp' : 'chevronDown'}
                  size="sm"
                  color={theme.colors.ai.fg}
                />
                <Text variant="labelSm" color={theme.colors.ai.fg}>
                  {expanded ? 'Hide reasoning' : 'Why this?'}
                </Text>
              </HStack>
            </Pressable>
            {expanded ? (
              <View
                style={{
                  padding: theme.space[3],
                  borderRadius: theme.radius.sm,
                  backgroundColor: theme.colors.surfaceInset,
                  borderLeftWidth: 2,
                  borderLeftColor: theme.colors.ai.border,
                }}
              >
                <Text variant="bodySm" tone="secondary">
                  {reasoning}
                </Text>
              </View>
            ) : null}
          </VStack>
        )}

        {hasActions ? (
          <>
            <Divider subtle />
            <HStack gap={2} wrap>
              {onApply === undefined ? null : (
                <Button
                  label={applyLabel}
                  variant="primary"
                  intent="ai"
                  size="sm"
                  iconLeft="check"
                  loading={applying}
                  onPress={onApply}
                />
              )}
              {onExplain === undefined ? null : (
                <Button
                  label="Explain"
                  variant="ghost"
                  intent="ai"
                  size="sm"
                  iconLeft="aiCopilot"
                  onPress={onExplain}
                />
              )}
            </HStack>
          </>
        ) : null}

        {/*
          The caveat is visible, not screen-reader-only. Everyone benefits from
          knowing a machine wrote this, and a hidden disclaimer is not a disclaimer.
        */}
        <Text variant="caption" tone="tertiary">
          AI-generated · review before acting
        </Text>
      </VStack>
    </Card>
  );
}
