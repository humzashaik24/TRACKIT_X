/**
 * Trackit X — AI provider configuration rules.
 *
 * The rules that decide what an organization is allowed to configure, and what
 * the Settings screen is allowed to claim. They live here, in one pure module,
 * for the same reason the RBAC helpers live in `src/domain/organization.ts`:
 * the screen, the service and the tests must not be able to disagree.
 *
 * ── Two rules this module exists to enforce ───────────────────────────────────
 *
 * 1. A disabled provider can never be the default. Not as a UI affordance that
 *    greys out a button, but as a rule the gateway resolver and the database
 *    both apply, because a client-side check is a suggestion.
 *
 * 2. A default that cannot be used is reported, never silently replaced. If an
 *    administrator disables the default provider, the organization is left with
 *    no usable default and the screen says so explicitly. Quietly promoting a
 *    second provider would hand the Copilot a different model than the one an
 *    administrator chose and paid for.
 */
import { canEditOrganization, type OrganizationRole } from '@/domain/organization';
import { defaultModelForProvider, getProviderDefinition, isModelSupportedForProvider } from './registry';
import type { AIProviderConfig, AIProviderId } from './types';

/**
 * The mask shown wherever a credential is confirmed to exist.
 *
 * A constant, on purpose. Deriving a mask from the secret — showing its last four
 * characters, its length, or a hash — hands part of the credential back to the
 * browser and into the JS bundle, which is the thing this architecture exists to
 * prevent. This string is the same for every provider and every key.
 */
export const CREDENTIAL_MASK = '••••••••••••';

/** Provider configuration is an administrative setting, not a personal one. */
export function canManageAIProviders(role: OrganizationRole | null | undefined): boolean {
  return canEditOrganization(role);
}

/**
 * Outcome of resolving which provider the Copilot should use.
 *
 * `unresolved` is a first-class state, not an error case. It is what an
 * organization is in when the marked default is unusable, and the UI must render
 * it as its own thing rather than falling back to "no default configured".
 */
export type DefaultProviderResolution =
  | { readonly kind: 'resolved'; readonly config: AIProviderConfig }
  | {
      readonly kind: 'unresolved';
      readonly config: AIProviderConfig | null;
      readonly reason: 'default_disabled' | 'none_marked';
    }
  | { readonly kind: 'none'; readonly config: null };

/**
 * Works out the effective default without ever inventing one.
 *
 * Only the marked default is considered. If a second provider happens to be
 * enabled, it is not promoted — the administrator's choice is the choice.
 */
export function resolveDefaultProvider(
  configs: readonly AIProviderConfig[],
): DefaultProviderResolution {
  const marked = configs.find((config) => config.isDefault);
  if (marked === undefined) return { kind: 'none', config: null };
  if (!marked.enabled) return { kind: 'unresolved', config: marked, reason: 'default_disabled' };
  return { kind: 'resolved', config: marked };
}

/**
 * A provider may only be marked default while enabled.
 *
 * Checked before the write as well as in the database, so the administrator gets
 * a sentence they can act on instead of a Postgres error code.
 */
export function canMarkAsDefault(config: Pick<AIProviderConfig, 'enabled'>): boolean {
  return config.enabled;
}

/**
 * Whether this provider may be disabled.
 *
 * Disabling the default is allowed, and the consequence is made visible by
 * `resolveDefaultProvider` rather than blocked here. Blocking it would hide a
 * legitimate action: turning a provider off is exactly what an administrator does
 * when that provider's key stops working.
 */
export function canDisable(config: Pick<AIProviderConfig, 'enabled'>): boolean {
  return config.enabled;
}

/**
 * Whether a connection test can be attempted at all.
 *
 * Requires a stored credential, because a test with no credential can only report
 * a failure that says nothing about the provider. The absence of the server-side
 * AI Gateway is reported separately and separately: this predicate is about
 * whether there is anything to test, not about whether the test can run.
 */
export function canTestConnection(
  config: Pick<AIProviderConfig, 'credentialState' | 'enabled'>,
): boolean {
  return config.credentialState === 'stored' && config.enabled;
}

/** Human-readable credential state. Never derived from the credential's value. */
export function describeCredential(config: Pick<AIProviderConfig, 'credentialState'>): string {
  return config.credentialState === 'stored' ? CREDENTIAL_MASK : 'Not configured';
}

export type ConnectionStatusPresentation = {
  readonly label: string;
  readonly tone: 'neutral' | 'success' | 'danger';
};

/**
 * Renders connection status from stored state only.
 *
 * There is no optimistic or "checking…" success state here, because a status that
 * can be set by the screen is a status that can be set to anything.
 */
export function describeConnectionStatus(
  config: Pick<AIProviderConfig, 'connectionStatus' | 'credentialState'>,
): ConnectionStatusPresentation {
  if (config.credentialState === 'absent') return { label: 'Not configured', tone: 'neutral' };
  if (config.connectionStatus === 'connected') return { label: 'Connected', tone: 'success' };
  if (config.connectionStatus === 'failed') return { label: 'Connection failed', tone: 'danger' };
  return { label: 'Unverified', tone: 'neutral' };
}

export interface ProviderConfigDraft {
  readonly provider: AIProviderId;
  readonly selectedModel: string;
  readonly enabled: boolean;
  readonly makeDefault: boolean;
}

export type DraftRejection =
  | 'unknown_provider'
  | 'model_not_supported'
  | 'default_requires_enabled';

export type DraftValidation =
  | { readonly ok: true; readonly draft: ProviderConfigDraft }
  | { readonly ok: false; readonly reason: DraftRejection; readonly detail: string };

/**
 * Validates what an administrator is about to save.
 *
 * The model check is provider-scoped on purpose. Model ids are not portable —
 * `gpt-5.6` means nothing to Gemini — so a cross-provider id must be rejected
 * here rather than failing later against the provider with an error that
 * explains nothing to the person who typed it.
 */
export function validateProviderDraft(
  draft: ProviderConfigDraft,
): DraftValidation {
  if (getProviderDefinition(draft.provider) === undefined) {
    return { ok: false, reason: 'unknown_provider', detail: draft.provider };
  }
  if (!isModelSupportedForProvider(draft.provider, draft.selectedModel)) {
    return {
      ok: false,
      reason: 'model_not_supported',
      detail: `${draft.provider}/${draft.selectedModel}`,
    };
  }
  if (draft.makeDefault && !draft.enabled) {
    return {
      ok: false,
      reason: 'default_requires_enabled',
      detail: draft.provider,
    };
  }
  return { ok: true, draft };
}

/** The model a provider should show when an administrator has not chosen one. */
export function resolveDraftModel(provider: AIProviderId, requested: string | null | undefined): string {
  if (requested !== null && requested !== undefined && requested.length > 0) return requested;
  return defaultModelForProvider(provider);
}
