/**
 * Trackit X — provider adapter selection.
 *
 * ── The only provider-specific branching in the gateway ──────────────────────
 * `index.ts` calls `selectAdapter(config.provider)` and then talks to the returned
 * `AIProviderAdapter`. It never learns whether the provider is Gemini, never
 * names a model, and never sees a URL or a header. Everything provider-specific
 * lives inside an adapter, and this file is the single point that maps a stored
 * provider id to an implementation.
 *
 * That is why the map below is keyed by registry lookup rather than being written
 * as a `switch`. A `switch` on provider id in the gateway would be a second place
 * to update when a provider is added, and the one place where forgetting would
 * fail open — an unmatched id returning a default adapter, say. Here an
 * unrecognised id returns nothing, the gateway refuses with
 * `AI_PROVIDER_NOT_CONFIGURED`, and the failure names the id in the log.
 *
 * ── Consistency is asserted, not assumed ─────────────────────────────────────
 * The keys are checked against `PROVIDER_REGISTRY` at module load. A registry
 * entry with no adapter, or an adapter for a provider that is not in the registry,
 * throws immediately rather than becoming a runtime surprise on the first request
 * from the organization that happens to use it.
 */
import { isSupportedProvider, PROVIDER_REGISTRY } from '../../../../src/domain/ai/registry.ts';
import type { AIProviderAdapter } from '../../../../src/domain/ai/gateway.ts';
import type { AIProviderId } from '../../../../src/domain/ai/types.ts';
import { geminiAdapter } from './gemini.ts';
import { openAiAdapter } from './openai.ts';
import { anthropicAdapter } from './anthropic.ts';
import { logGateway } from '../http.ts';

/**
 * Every adapter, keyed by the provider it serves.
 *
 * The key type is `AIProviderId` and not `string`, so adding a provider to the
 * registry without writing an adapter is a type error at this line rather than a
 * runtime failure later.
 */
const ADAPTERS: Readonly<Record<AIProviderId, AIProviderAdapter>> = {
  gemini: geminiAdapter,
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
};

/**
 * Verifies the adapter table and the registry agree, once, at module load.
 *
 * Two failures are possible and both are bugs in this repository rather than
 * configuration: a provider in the registry with no adapter, and an adapter whose
 * `provider` field disagrees with the key it is filed under. The second is the
 * one worth catching, because a mismatched pair would pass a request to the wrong
 * implementation and the request would simply fail at the provider.
 */
function assertRegistryAndAdaptersAgree(): void {
  const registryIds = PROVIDER_REGISTRY.map((provider) => provider.providerId);
  const adapterIds = Object.keys(ADAPTERS) as AIProviderId[];

  for (const providerId of registryIds) {
    if (!isSupportedProvider(providerId)) {
      throw new Error(`Registry provider ${providerId} is not a supported provider id.`);
    }
    if (!(providerId in ADAPTERS)) {
      throw new Error(`No AI provider adapter is registered for ${providerId}.`);
    }
  }

  for (const providerId of adapterIds) {
    if (!registryIds.includes(providerId)) {
      throw new Error(`AI provider adapter ${providerId} has no registry entry.`);
    }
    if (ADAPTERS[providerId].provider !== providerId) {
      throw new Error(
        `AI provider adapter filed under ${providerId} reports provider ${ADAPTERS[providerId].provider}.`,
      );
    }
  }
}

assertRegistryAndAdaptersAgree();

/**
 * The adapter for a stored provider id.
 *
 * Returns null for anything the registry does not declare. The gateway treats
 * null as "this configuration cannot be served" and refuses before any credential
 * is read, which is the right order: an unknown provider must not cause a vault
 * lookup.
 */
export function selectAdapter(providerId: string): AIProviderAdapter | null {
  if (!isSupportedProvider(providerId)) {
    logGateway('warn', 'adapter_selection_failed', { providerId });
    return null;
  }
  return ADAPTERS[providerId];
}

/** Every provider this gateway can serve. Read by `status` and by the tests. */
export function supportedGatewayProviders(): readonly AIProviderId[] {
  return Object.keys(ADAPTERS) as AIProviderId[];
}
