/**
 * Trackit X — AI Gateway contract.
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * The typed boundary between the Trackit X client and the future AI Gateway. It
 * describes what the server must be able to do; it deliberately implements none
 * of it, because the server does not exist yet.
 *
 * ── Where the credential lives ────────────────────────────────────────────────
 * `SecretMaterial` is branded so that a raw string cannot be passed where a
 * credential is expected. It is a compile-time marker only and erases entirely
 * at build time — the guarantee it provides is that this code cannot accidentally
 * *read* a credential, not that it contains one. Only a server-side
 * implementation of `AIProviderAdapter` may ever hold a real `SecretMaterial`, and
 * no such implementation exists in this repository or in the client bundle.
 *
 * ── Why there is no `fetch` in this file ─────────────────────────────────────
 * A connection test that ran from the browser would have to read the credential
 * to do it, which would put the credential in the bundle and in the network tab.
 * The route below is therefore a declaration of intent: the client POSTs the
 * *config id*, never a key, and the server looks the key up in the vault.
 */
import type { AIModelDefinition, AIProviderConfig, AIProviderId, AIRequest, AIResponse } from './types.ts';
import { err, type ActionResult } from '@/utils/result.ts';
import { appError } from '@/utils/errors.ts';

declare const secretMaterialBrand: unique symbol;

/**
 * A credential read from the server-side vault.
 *
 * The brand means a `string` cannot be passed here by accident. Construct it in
 * one place only: the server-side vault adapter, immediately after a successful
 * lookup, and never in a file reachable from the client.
 */
export type SecretMaterial = string & { readonly [secretMaterialBrand]: 'AISecretMaterial' };

/** The endpoint the AI Gateway must expose for connection testing. */
export const GATEWAY_ROUTE_TEST_CONNECTION = '/functions/v1/ai-gateway/test-connection';
/** The endpoint the AI Gateway must expose for Copilot requests. */
export const GATEWAY_ROUTE_GENERATE = '/functions/v1/ai-gateway/generate';

/** How long a client should wait before telling an administrator to retry. */
export const GATEWAY_TIMEOUT_MS = 30_000;

export interface ConnectionTestReport {
  readonly provider: AIProviderId;
  readonly model: string;
  /** True only when the server actually reached the provider and was authorised. */
  readonly reachable: boolean;
  readonly latencyMs: number;
  /** Correlated gateway request id, for support. Carries no provider payload. */
  readonly requestId: string;
  /**
   * A safe, provider-agnostic reason when `reachable` is false — e.g.
   * 'credentials_rejected'. Never the provider's raw response body, which can
   * echo back part of the submitted key.
   */
  readonly failureReason: AIConnectionFailureReason | null;
}

export type AIConnectionFailureReason =
  | 'credentials_rejected'
  | 'provider_unreachable'
  | 'provider_error'
  | 'timeout'
  | 'gateway_unavailable';

/**
 * Server-side adapter for one provider.
 *
 * An adapter is the only thing that knows a provider's wire format. It is
 * constructed with a credential and used for exactly one call, then discarded, so
 * no long-lived object in the system ever holds a key.
 */
export interface AIProviderAdapter {
  readonly provider: AIProviderId;

  /**
   * Performs a single cheap authenticated call to the provider.
   *
   * Must not throw provider text upward: failures come back as a
   * `ConnectionTestReport` with a `failureReason`, because provider error bodies
   * are the most likely place for a credential fragment to reappear.
   */
  testConnection(
    credential: SecretMaterial,
    model: string,
  ): Promise<ActionResult<ConnectionTestReport>>;

  /** Generates one completion. Not implemented in this phase. */
  generate(
    credential: SecretMaterial,
    request: AIRequest,
  ): Promise<ActionResult<AIResponse>>;

  /**
   * Models this adapter can serve. Backed by the client registry for now, so the
   * Gateway and the Settings screen can never disagree about what is offered.
   */
  listSupportedModels(): readonly AIModelDefinition[];
}

/**
 * Organization-scoped entry point the Copilot will call.
 *
 * Note what the client passes: a configuration id, never a provider and never a
 * credential. The Gateway resolves the organization, reads the marked default,
 * checks it is enabled and configured, fetches the credential, and only then
 * builds an adapter. That ordering is the reason a disabled or unconfigured
 * provider cannot be reached even if the caller asks for it by name.
 */
export interface AIGateway {
  /**
   * Runs a connection test for one stored configuration.
   *
   * @param configId `ai_provider_configs.id`. The server resolves the
   *   organization from the caller's membership, never from a parameter.
   */
  testConnection(configId: string): Promise<ActionResult<ConnectionTestReport>>;

  /** Sends a Copilot request. Not implemented in this phase. */
  generate(request: AIRequest): Promise<ActionResult<AIResponse>>;
}

/**
 * The Gateway's availability, as far as the client is concerned.
 *
 * This is a fact about the deployment, not a guess: Trackit X currently ships as
 * a static web bundle with no server runtime, so no Gateway is deployed and no
 * provider call can be made. The Settings screen reads this to decide whether to
 * offer "Test Connection" as an action or as an explanation.
 */
export const GATEWAY_AVAILABLE = false;

export const GATEWAY_UNAVAILABLE_REASON =
  'Trackit X has no AI Gateway deployed yet, so provider credentials cannot be stored and no provider can be reached.';

/**
 * The unimplemented gateway.
 *
 * Every call fails, loudly and identically, rather than returning a plausible
 * success. This exists so that a caller which forgets to check availability gets
 * a clear error instead of a fabricated result.
 */
export const unavailableGateway: AIGateway = {
  async testConnection(): Promise<ActionResult<ConnectionTestReport>> {
    return err(
      appError(
        'AI_UNAVAILABLE',
        'No AI Gateway is deployed, so no provider can be reached from the client.',
        {
          userMessage: 'AI provider testing is not available yet.',
          context: { reason: 'gateway_unavailable' },
        },
      ),
    );
  },
  async generate(): Promise<ActionResult<AIResponse>> {
    return err(
      appError('AI_UNAVAILABLE', 'No AI Gateway is deployed, so generation is unreachable.', {
        userMessage: 'The Trackit X Copilot is not available yet.',
        context: { reason: 'gateway_unavailable' },
      }),
    );
  },
};

/**
 * Asserts that a configuration is one the gateway would actually serve.
 *
 * A client-side courtesy check, for immediate feedback before a request is sent.
 * It is NOT the control. The Edge Function does not call this — it authorizes
 * through the SQL RPC, reads `credential_present` from the same read, and
 * returns `AI_PROVIDER_DISABLED` or `AI_PROVIDER_NOT_CONFIGURED` itself. An
 * earlier version of this comment claimed the rule was also applied "on the
 * server for the decision that counts"; that was never true of this function, and
 * it is worth stating plainly because a rule that only the client enforces is
 * worth exactly nothing against a crafted request.
 *
 * Keep the two in agreement, and expect the server's answer to be the one that
 * counts.
 */
export function assertGatewayEligible(config: AIProviderConfig): ActionResult<AIProviderConfig> {
  if (!config.enabled) {
    return err(
      appError('AI_ACTION_NOT_PERMITTED', 'Gateway target is a disabled provider.', {
        userMessage: 'That AI provider is switched off for your organization.',
        context: { provider: config.provider, reason: 'provider_disabled' },
      }),
    );
  }
  if (config.credentialState === 'absent') {
    return err(
      appError('AI_ACTION_NOT_PERMITTED', 'Gateway target has no stored credential.', {
        userMessage: 'That AI provider has no stored credential yet.',
        context: { provider: config.provider, reason: 'credential_absent' },
      }),
    );
  }
  return { ok: true, value: config };
}
