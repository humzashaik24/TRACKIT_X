/**
 * Trackit X — AI provider configuration service.
 *
 * Reads and writes the safe configuration metadata for one organization. It
 * handles no credentials at all: credential submission and connection testing
 * are delegated to ports that are honestly unimplemented, because the server
 * runtime they need does not exist yet.
 *
 * ── The column list ──────────────────────────────────────────────────────────
 * Every read below names its columns explicitly. That is not style. The
 * `authenticated` role holds no SELECT privilege on `secret_reference`, so an
 * explicit list is what keeps this service compiling against a type that has no
 * such field — the omission is enforced at the type layer, the privilege layer
 * and the query layer at once. A `select('*')` would fail at runtime; it would
 * not silently leak, and that is the point of doing it three ways.
 *
 * ── Error mapping ────────────────────────────────────────────────────────────
 * A write refused by RLS returns no rows and no error, which is indistinguishable
 * from a successful write that changed nothing. `requireAffectedRows` turns that
 * silence into `PERMISSION_DENIED`, matching `updateOrganization`. Without it a
 * member who found a way to press the button would see a success toast for a
 * change that was never made.
 */
import {
  resolveDraftModel,
  validateProviderDraft,
  type ProviderConfigDraft,
} from '@/domain/ai/configuration';
import {
  GATEWAY_AVAILABLE,
  GATEWAY_ROUTE_GENERATE,
  GATEWAY_ROUTE_TEST_CONNECTION,
  GATEWAY_UNAVAILABLE_REASON,
  type ConnectionTestReport,
} from '@/domain/ai/gateway';
import { getProviderDefinition } from '@/domain/ai/registry';
import type { AIProviderConfig, AIProviderId } from '@/domain/ai/types';
import { supabase } from '@/lib/supabase';
import { assertNoCredentialFields } from '@/services/aiSecretVault';
import {
  revokeCredential as gatewayRevokeCredential,
  submitCredential as gatewaySubmitCredential,
  testConnection as gatewayTestConnection,
} from '@/services/aiGatewayService';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';
import type { AIProviderConfigRow } from '@/types/database';

const log = logger.child({ module: 'aiProviderService' });

/**
 * Columns the client may read.
 *
 * `secret_reference` is not here because the role cannot select it. Keeping the
 * list in one constant means adding a column to the table cannot silently widen
 * what this service returns.
 */
const READABLE_COLUMNS =
  'id, organization_id, provider, display_name, enabled, is_default, selected_model, credential_present, connection_status, last_tested_at, created_at, updated_at';

export interface SaveProviderConfigInput {
  readonly organizationId: string;
  readonly provider: AIProviderId;
  readonly selectedModel?: string;
  readonly enabled?: boolean;
  readonly makeDefault?: boolean;
}

/**
 * Maps a database row onto the client domain type.
 *
 * A pure projection: it copies named fields and derives nothing. There is no
 * masking step here, because a mask built from a credential would be a partial
 * disclosure — `describeCredential` in the domain layer uses a fixed string for
 * exactly that reason.
 */
export function mapRowToProviderConfig(row: AIProviderConfigRow): AIProviderConfig {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    displayName: row.display_name,
    enabled: row.enabled,
    isDefault: row.is_default,
    selectedModel: row.selected_model,
    credentialState: row.credential_present ? 'stored' : 'absent',
    connectionStatus: row.connection_status,
    lastTestedAt: row.last_tested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A write that RLS silently discarded.
 *
 * RLS filters rows rather than refusing them, so a member's UPDATE matches zero
 * rows and PostgREST reports success. Treating that as success would tell an
 * administrator their change was saved when it was not.
 */
function requireAffectedRows(count: number | null, operation: string): ActionResult<true> {
  if (count === null || count === 0) {
    return err(
      appError('PERMISSION_DENIED', `${operation} matched no rows; RLS refused it.`, {
        userMessage: 'Only an organization admin can change AI provider settings.',
        context: { operation },
      }),
    );
  }
  return ok(true);
}

export async function listProviderConfigs(
  organizationId: string,
): Promise<ActionResult<readonly AIProviderConfig[]>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('ai_provider_configs')
      .select(READABLE_COLUMNS)
      .eq('organization_id', organizationId)
      .order('provider', { ascending: true });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not list AI provider configuration', { code: result.error.code });
    return result;
  }

  return ok(result.value.map(mapRowToProviderConfig));
}

export async function getProviderConfig(
  organizationId: string,
  provider: AIProviderId,
): Promise<ActionResult<AIProviderConfig | null>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('ai_provider_configs')
      .select(READABLE_COLUMNS)
      .eq('organization_id', organizationId)
      .eq('provider', provider)
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) return ok(null);
  return ok(mapRowToProviderConfig(result.value));
}

/**
 * Creates or updates the safe configuration for one provider.
 *
 * ── Why this is not an `upsert` ────────────────────────────────────────────────
 * PostgREST expands `ON CONFLICT DO UPDATE` to set *every* column in the
 * payload, including `organization_id` and `provider`. The migration grants the
 * `authenticated` role UPDATE on `display_name`, `enabled` and `selected_model`
 * only, so an upsert of an already-configured provider would be refused with
 * `42501` for lack of privilege on the immutable columns — the common case, and
 * the one that would fail.
 *
 * Granting those columns instead would widen the write surface for no benefit:
 * `guard_tenant_columns_immutable` would reject the change anyway, so the grant
 * would buy nothing and cost defence in depth. So the two paths are explicit, and
 * the update path names only the three columns the role may actually write.
 *
 * The extra read costs one round trip and makes the privilege model match the
 * code, which is the more valuable of the two.
 */
export async function saveProviderConfig(
  input: SaveProviderConfigInput,
): Promise<ActionResult<AIProviderConfig>> {
  const definition = getProviderDefinition(input.provider);
  if (definition === undefined) {
    return err(
      appError('VALIDATION_FAILED', `Unknown AI provider '${input.provider}'.`, {
        context: { provider: input.provider },
      }),
    );
  }

  const selectedModel = resolveDraftModel(input.provider, input.selectedModel);
  const draft: ProviderConfigDraft = {
    provider: input.provider,
    selectedModel,
    enabled: input.enabled ?? false,
    makeDefault: input.makeDefault ?? false,
  };

  const validation = validateProviderDraft(draft);
  if (!validation.ok) {
    return err(
      appError('VALIDATION_FAILED', `Rejected provider draft: ${validation.reason}.`, {
        userMessage:
          validation.reason === 'model_not_supported'
            ? 'That model is not offered by this provider.'
            : 'A provider must be switched on before it can be the default.',
        context: { reason: validation.reason, detail: validation.detail },
      }),
    );
  }

  const payload = {
    organization_id: input.organizationId,
    provider: input.provider,
    display_name: definition.displayName,
    enabled: draft.enabled,
    selected_model: draft.selectedModel,
  } as const;

  // Last-line guard. The column grants already make a credential column
  // unwritable; this fails loudly if a future column is added and filled.
  const guard = assertNoCredentialFields(payload);
  if (!guard.ok) return guard;

  // The update path carries only the columns the role may write. `organization_id`
  // and `provider` are deliberately absent: they are the row's identity, the
  // migration withholds UPDATE on them, and the tenant-guard trigger pins them.
  const existing = await getProviderConfig(input.organizationId, input.provider);
  if (!existing.ok) return existing;

  const result = await attempt(async () => {
    if (existing.value === null) {
      const { data, error } = await supabase
        .from('ai_provider_configs')
        .insert(payload)
        .select(READABLE_COLUMNS)
        .single();
      if (error !== null) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('ai_provider_configs')
      .update({
        display_name: definition.displayName,
        enabled: draft.enabled,
        selected_model: draft.selectedModel,
      })
      .eq('organization_id', input.organizationId)
      .eq('provider', input.provider)
      .select(READABLE_COLUMNS)
      .maybeSingle();
    if (error !== null) throw error;
    // A concurrent delete between the read and the write leaves nothing to update.
    if (data === null) {
      throw new Error('ai_provider_config_missing_during_update');
    }
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not save AI provider configuration', {
      provider: input.provider,
      code: result.error.code,
    });
    return result;
  }

  const saved = mapRowToProviderConfig(result.value);

  if (!draft.makeDefault) return ok(saved);

  return setDefaultProvider(input.organizationId, input.provider);
}

/**
 * Marks one enabled provider as the organization default.
 *
 * The RPC unsets the previous default in the same transaction, so an
 * organization is never briefly pointed at two providers.
 */
export async function setDefaultProvider(
  organizationId: string,
  provider: AIProviderId,
): Promise<ActionResult<AIProviderConfig>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase.rpc('set_default_ai_provider', {
      p_organization_id: organizationId,
      p_provider: provider,
    });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not set the default AI provider', {
      provider,
      code: result.error.code,
    });
    return result;
  }

  return ok(mapRowToProviderConfig(result.value));
}

/**
 * Removes the default, leaving the organization with none.
 *
 * Used when the default provider is disabled. The alternative — promoting a
 * second provider — would silently change which model answers, so the
 * organization is left in an explicit unresolved state instead.
 */
export async function clearDefaultProvider(
  organizationId: string,
): Promise<ActionResult<undefined>> {
  const result = await attempt(async () => {
    const { error } = await supabase.rpc('clear_default_ai_provider', {
      p_organization_id: organizationId,
    });
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not clear the default AI provider', { code: result.error.code });
    return result;
  }
  return ok(undefined);
}

export async function removeProviderConfig(
  organizationId: string,
  provider: AIProviderId,
): Promise<ActionResult<undefined>> {
  const result = await attempt(async () => {
    const { count, error } = await supabase
      .from('ai_provider_configs')
      .delete({ count: 'exact' })
      .eq('organization_id', organizationId)
      .eq('provider', provider);
    if (error !== null) throw error;
    return count;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not remove AI provider configuration', {
      provider,
      code: result.error.code,
    });
    return result;
  }

  const written = requireAffectedRows(result.value, 'ai_provider_config_delete');
  if (!written.ok) return written;
  return ok(undefined);
}

/**
 * Asks the AI Gateway to test one stored configuration.
 *
 * The client sends a configuration id and nothing else. The credential is
 * fetched by the Gateway from the vault, so it never crosses the network to the
 * browser in either direction.
 *
 * While no Gateway is deployed this fails, and the stored `connection_status` is
 * left exactly as it was. In particular it is never optimistically set to
 * `connected` — that column is not client-writable, and the point of the
 * architecture is that no client path can set it.
 */
export interface AIGatewayStatus {
  /** False until a server runtime exists. Drives whether Test Connection is an action or an explanation. */
  readonly available: boolean;
  readonly reason: string;
  readonly connectionTestRoute: string;
  readonly generateRoute: string;
}

/**
 * What the Settings screen needs to know about the Gateway, from one place.
 *
 * A screen that checked `GATEWAY_AVAILABLE` itself would be free to check it
 * wrongly, so the fact is passed through the service the screen already depends
 * on.
 */
export function getAIGatewayStatus(): AIGatewayStatus {
  return {
    available: GATEWAY_AVAILABLE,
    reason: GATEWAY_UNAVAILABLE_REASON,
    connectionTestRoute: GATEWAY_ROUTE_TEST_CONNECTION,
    generateRoute: GATEWAY_ROUTE_GENERATE,
  };
}

export async function testProviderConnection(
  configId: string,
): Promise<ActionResult<ConnectionTestReport>> {
  // Routed through the gateway service, which is the only thing in the client that
  // speaks to the Edge Function. It is still refused while `GATEWAY_AVAILABLE` is
  // false, so the reason a caller sees is unchanged until a gateway is deployed.
  return gatewayTestConnection(configId);
}

/**
 * Hands a credential to the server-side vault.
 *
 * Takes a `configId`, not an `organizationId` and a `provider`. That is the whole
 * point of the Phase 36 gateway: the organization is read from the configuration
 * row the server authorizes, so a client cannot name the organization a credential
 * is stored against. The previous signature asked the client for both, which the
 * gateway protocol now rejects outright.
 *
 * Returns `void` on success. The caller re-reads the configuration afterwards,
 * which will then report `credential_present`; the credential itself is never
 * returned, never written to a column the client can read, and never logged.
 */
export async function submitProviderCredential(params: {
  readonly configId: string;
  readonly credential: string;
}): Promise<ActionResult<undefined>> {
  const result = await gatewaySubmitCredential({
    configId: params.configId,
    credential: params.credential,
  });

  return result.ok ? ok(undefined) : result;
}

/**
 * Removes a stored credential.
 *
 * Idempotent, so a second revoke is not an error the user has to understand.
 */
export async function revokeProviderCredential(
  configId: string,
): Promise<ActionResult<undefined>> {
  const result = await gatewayRevokeCredential(configId);

  return result.ok ? ok(undefined) : result;
}
