/**
 * Trackit X — AI provider and model registry.
 *
 * ── Why this is a controlled registry ─────────────────────────────────────────
 * Model lineups move faster than this application does. Rather than discovering
 * models at runtime from a provider's API — which would require shipping a
 * provider credential to the client, the exact thing this architecture forbids —
 * the supported set is declared here and presented to the administrator as a
 * choice they make deliberately.
 *
 * ── Honesty rules for this file ───────────────────────────────────────────────
 *  · Every model carries `verifiedOn`, the date it was last read from the
 *    provider's own documentation. An entry with no date is an unfalsifiable
 *    claim, so the type makes one impossible.
 *  · `contextWindowTokens` is a published number or `null`. Where a provider does
 *    not publish a figure we are willing to stand behind, the field is `null` and
 *    the UI says "not published". A wrong context window is worse than an absent
 *    one, because it silently truncates a prompt.
 *  · Models known to be retired or superseded are not listed, even when the
 *    provider still answers to them.
 *
 * ── Adding a provider ─────────────────────────────────────────────────────────
 * Append an entry to `PROVIDER_REGISTRY`, add the id to `AIProviderId`, and add
 * the value to `public.ai_provider` in a new migration. No other module changes:
 * the Settings screen, the service layer and the gateway all read provider data
 * from here rather than switching on provider ids.
 */
import type { AIModelDefinition, AIProviderDefinition, AIProviderId } from './types.ts';

/** ISO date the entries below were last checked against provider documentation. */
export const MODEL_REGISTRY_VERIFIED_ON = '2026-09-27';

const GOOGLE_MODELS: readonly AIModelDefinition[] = [
  {
    modelId: 'gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash',
    summary: 'Stable general-purpose workhorse. Trackit X default for Gemini.',
    contextWindowTokens: null,
    capabilities: ['text', 'reasoning', 'code', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    summary: 'Newest Flash generation, aimed at long-horizon agentic work.',
    contextWindowTokens: null,
    capabilities: ['text', 'reasoning', 'code', 'long_context', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash-Lite',
    summary: 'Cheapest option here. Suited to high-volume, low-complexity asks.',
    contextWindowTokens: null,
    capabilities: ['text', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro (preview)',
    summary: 'Deepest reasoning in the Gemini line. A preview, so it may change.',
    contextWindowTokens: null,
    capabilities: ['text', 'reasoning', 'code', 'long_context', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    summary: 'Previous generation, retained for a documented 1M token window.',
    contextWindowTokens: 1_000_000,
    capabilities: ['text', 'reasoning', 'code', 'long_context'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
];

const OPENAI_MODELS: readonly AIModelDefinition[] = [
  {
    modelId: 'gpt-5.6',
    displayName: 'GPT-5.6',
    summary: 'Flagship line for complex professional work. Trackit X default for OpenAI.',
    contextWindowTokens: null,
    capabilities: ['text', 'reasoning', 'code', 'long_context', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    summary: 'Same generation, tuned for cost-sensitive workloads.',
    contextWindowTokens: null,
    capabilities: ['text', 'reasoning', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'gpt-5-mini',
    displayName: 'GPT-5 mini',
    summary: 'Small, fast and cheap. For routing and classification tasks.',
    contextWindowTokens: null,
    capabilities: ['text', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
];

const ANTHROPIC_MODELS: readonly AIModelDefinition[] = [
  {
    modelId: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    summary: 'Best balance of speed and intelligence. Trackit X default for Anthropic.',
    contextWindowTokens: 1_000_000,
    capabilities: ['text', 'reasoning', 'code', 'long_context', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    summary: 'For complex agentic coding and heavier enterprise reasoning.',
    contextWindowTokens: 1_000_000,
    capabilities: ['text', 'reasoning', 'code', 'long_context', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'claude-fable-5-1',
    displayName: 'Claude Fable 5.1',
    summary: 'Highest available capability, for demanding long-horizon work.',
    contextWindowTokens: 1_000_000,
    capabilities: ['text', 'reasoning', 'code', 'long_context', 'structured_output'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
  {
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    summary: 'Fastest, near-frontier. Pinned snapshot, so behaviour will not drift.',
    contextWindowTokens: 200_000,
    capabilities: ['text', 'reasoning', 'code'],
    verifiedOn: MODEL_REGISTRY_VERIFIED_ON,
  },
];

/**
 * Every provider Trackit X can be pointed at. Read by the UI, the service layer
 * and the future gateway; never switched on by a `case`.
 */
export const PROVIDER_REGISTRY: readonly AIProviderDefinition[] = [
  {
    providerId: 'gemini',
    displayName: 'Google Gemini',
    summary: 'Google DeepMind models. A strong default when cost matters.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    secretLabel: 'Google AI Studio API key',
    defaultModelId: 'gemini-3.6-flash',
    models: GOOGLE_MODELS,
  },
  {
    providerId: 'openai',
    displayName: 'OpenAI',
    summary: 'GPT family models, served through the OpenAI API.',
    docsUrl: 'https://developers.openai.com/api/docs/models',
    secretLabel: 'OpenAI API key',
    defaultModelId: 'gpt-5.6',
    models: OPENAI_MODELS,
  },
  {
    providerId: 'anthropic',
    displayName: 'Anthropic',
    summary: 'Claude models. Noted for careful instruction-following.',
    docsUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview',
    secretLabel: 'Anthropic API key',
    defaultModelId: 'claude-sonnet-5',
    models: ANTHROPIC_MODELS,
  },
];

export function isSupportedProvider(value: string): value is AIProviderId {
  return PROVIDER_REGISTRY.some((provider) => provider.providerId === value);
}

export function getProviderDefinition(providerId: AIProviderId): AIProviderDefinition | undefined {
  return PROVIDER_REGISTRY.find((provider) => provider.providerId === providerId);
}

export function getModelDefinition(
  providerId: AIProviderId,
  modelId: string,
): AIModelDefinition | undefined {
  return getProviderDefinition(providerId)?.models.find((model) => model.modelId === modelId);
}

/**
 * A model id is valid for a provider only if that provider declares it.
 *
 * This is the check that stops `gpt-5.6` being saved against Gemini: model ids
 * are provider-scoped, and a cross-provider id would fail at the provider with an
 * error that says nothing useful to an administrator.
 */
export function isModelSupportedForProvider(providerId: AIProviderId, modelId: string): boolean {
  return getModelDefinition(providerId, modelId) !== undefined;
}

/**
 * Applied when an administrator saves a provider without choosing a model.
 *
 * `defaultModelId` is authoritative. It is a field a maintainer sets on purpose,
 * whereas `models[0]` is only whatever happens to be first in the array, so
 * preferring it would let a cosmetic reorder silently change what an
 * administrator gets by default.
 *
 * The registry is non-empty by construction and a model list is non-empty by
 * construction, so the final fallback is a literal rather than a lookup: a
 * provider that somehow had no declared model would surface as a validation
 * error against this id rather than as `undefined` reaching a database write.
 */
const FALLBACK_MODEL_ID = 'unspecified-model';

export function defaultModelForProvider(providerId: AIProviderId): string {
  const definition = getProviderDefinition(providerId);
  if (definition === undefined) return FALLBACK_MODEL_ID;
  return definition.defaultModelId || (definition.models[0]?.modelId ?? FALLBACK_MODEL_ID);
}
