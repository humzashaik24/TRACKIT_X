/**
 * Trackit X — Supabase Vault adapter.
 *
 * Implements the server-side `SecretVault` port against Supabase Vault, using
 * ONLY the Phase 36 RPCs. It issues no table query, no `vault.*` call, and no
 * direct read of `ai_provider_configs`: the database does the authorization and
 * the vault work, and this file's entire job is to pass an actor id and a
 * configuration id through and hand back what comes out.
 *
 * ── The privilege design this must not undo ─────────────────────────────────
 * Phase 35 granted `service_role` no table privileges on `ai_provider_configs`,
 * and Phase 36 did not add any. The consequence is that this adapter CANNOT read
 * that table even if it wanted to: `service_role` is a BYPASSRLS role, not a
 * superuser, and without a column privilege it reads nothing. The five
 * `ai_gateway_*` SECURITY DEFINER functions are the only route, and each of them
 * re-checks the acting user's membership of the configuration's organization in
 * SQL.
 *
 * That is the reason this file is small. If it grows, the growth is either a new
 * RPC (good) or an attempt to reach the table directly (bad), and the second
 * would mean adding back the grant that was deliberately withheld.
 *
 * ── What leaves this file ───────────────────────────────────────────────────
 * `getProviderCredential` returns `SecretMaterial`, which goes straight into a
 * provider adapter and is never stored, logged, or returned. The other two
 * methods return only booleans and configuration ids — never a handle, never a
 * secret. The vault uuid is returned by the SQL function because the Edge Function
 * is its only caller, and it is dropped here rather than propagated.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { appError } from '../../../src/utils/errors.ts';
import { err, ok, type ActionResult } from '../../../src/utils/result.ts';
import { toSecretMaterial, type SecretVault } from '../../../src/domain/ai/gatewayVault.ts';
import type { SecretMaterial } from '../../../src/domain/ai/gateway.ts';
import { logGateway } from './http.ts';

/**
 * SQLSTATE values the RPCs raise, and what each one means to us.
 *
 * `42501` is `insufficient_privilege` and covers all three refusal shapes in
 * `ai_gateway_resolve_config`: not the gateway's role, not a member of the
 * organization, and not an administrator. The SQL deliberately makes the last two
 * indistinguishable, so this adapter cannot tell them apart either — and must not
 * try, or it would reintroduce the oracle at the application layer.
 *
 * `P0002` is `no_data_found` and means the configuration exists and is authorized
 * but holds no credential.
 */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = '42501';
const SQLSTATE_NO_DATA = 'P0002';

/** Narrows an unknown PostgREST error to a SQLSTATE. */
function sqlStateOf(error: { code?: string } | null): string | null {
  return error?.code ?? null;
}

/**
 * Wraps a PostgREST failure as a safe `AppError`.
 *
 * The provider-facing distinction that matters is "you may not" versus "there is
 * nothing there", because the first is retryable by nobody and the second is a
 * setup problem an administrator can fix. `message` here is a fixed string per
 * branch — the PostgREST `message` from the database is never forwarded, because
 * these are SECURITY DEFINER functions raising with prose, and prose about an
 * internal lookup is not the client's business.
 */
function rpcFailure(
  operation: 'read' | 'store' | 'delete',
  error: { code?: string } | null,
): ReturnType<typeof err> {
  const state = sqlStateOf(error);

  if (state === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
    return err(
      appError('AI_UNAUTHORIZED', `Vault ${operation} refused by authorization.`, {
        userMessage: 'You are not allowed to manage AI provider credentials here.',
        retryable: false,
        context: { operation, sqlstate: state },
      }),
    );
  }

  if (state === SQLSTATE_NO_DATA) {
    return err(
      appError('AI_PROVIDER_NOT_CONFIGURED', `Vault ${operation} found no stored credential.`, {
        userMessage: 'AI provider credentials are not configured.',
        retryable: false,
        context: { operation, sqlstate: state },
      }),
    );
  }

  return err(
    appError('AI_PROVIDER_UNAVAILABLE', `Vault ${operation} failed.`, {
      userMessage: 'The AI provider could not be reached. Please try again shortly.',
      retryable: true,
      context: { operation, sqlstate: state ?? 'none' },
    }),
  );
}

/**
 * Builds the adapter.
 *
 * @param url Supabase project URL.
 * @param serviceRoleKey The service role key. Server-side only. It is read from
 *   the function's environment and must never carry an `EXPO_PUBLIC_` prefix,
 *   which would inline it into the web bundle.
 */
export function createSupabaseVault(
  url: string,
  serviceRoleKey: string,
): { vault: SecretVault; client: SupabaseClient } {
  // `auth.persistSession: false` because there is no user session here and no
  // storage to persist into; `autoRefreshToken: false` for the same reason. A
  // service-role client that tried to persist a session would write a token to
  // disk in the function container for no benefit.
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const vault: SecretVault = {
    availability: {
      available: true,
      reason: 'Supabase Vault is reachable from the gateway.',
      requirements: [],
    },

    async getProviderCredential({ userId, organizationId, configId }): Promise<
      ActionResult<SecretMaterial>
    > {
      const { data, error } = await client.rpc('ai_gateway_read_credential', {
        p_actor_id: userId,
        p_config_id: configId,
      });

      if (error !== null) {
        logGateway('warn', 'vault_read_refused', {
          operation: 'read',
          organizationId,
          sqlstate: sqlStateOf(error) ?? 'none',
        });
        return rpcFailure('read', error) as ActionResult<SecretMaterial>;
      }

      if (typeof data !== 'string' || data.length === 0) {
        // The SQL raises rather than returning NULL, so a non-string here means
        // the function's signature changed under us. That is a deployment
        // mismatch, not a missing key, and it is logged as one.
        logGateway('error', 'vault_read_unexpected_shape', { operation: 'read', organizationId });
        return err(
          appError('AI_PROVIDER_NOT_CONFIGURED', 'Vault read returned an unexpected shape.', {
            userMessage: 'AI provider credentials are not configured.',
            retryable: false,
          }),
        );
      }

      // Note what is NOT logged here: the credential, its length, and a prefix.
      // Only that a read succeeded.
      logGateway('info', 'vault_read_ok', { operation: 'read', organizationId });
      return ok(toSecretMaterial(data));
    },

    async storeProviderCredential({
      userId,
      organizationId,
      configId,
      credential,
    }): Promise<ActionResult<{ readonly configId: string; readonly stored: boolean }>> {
      const { data, error } = await client.rpc('ai_gateway_store_credential', {
        p_actor_id: userId,
        p_config_id: configId,
        p_credential: credential,
      });

      if (error !== null) {
        logGateway('warn', 'vault_store_refused', {
          operation: 'store',
          organizationId,
          sqlstate: sqlStateOf(error) ?? 'none',
        });
        return rpcFailure('store', error) as ActionResult<{ configId: string; stored: boolean }>;
      }

      // `data` is the vault uuid. It is deliberately not returned, not logged and
      // not compared: acknowledging it would only give a future change somewhere
      // to leak it from. The client's answer is whether a credential now exists.
      void data;
      logGateway('info', 'vault_store_ok', { operation: 'store', organizationId });
      return ok({ configId, stored: true });
    },

    async deleteProviderCredential({ userId, organizationId, configId }): Promise<
      ActionResult<undefined>
    > {
      const { error } = await client.rpc('ai_gateway_delete_credential', {
        p_actor_id: userId,
        p_config_id: configId,
      });

      if (error !== null) {
        logGateway('warn', 'vault_delete_refused', {
          operation: 'delete',
          organizationId,
          sqlstate: sqlStateOf(error) ?? 'none',
        });
        return rpcFailure('delete', error) as ActionResult<undefined>;
      }

      logGateway('info', 'vault_delete_ok', { operation: 'delete', organizationId });
      return ok(undefined);
    },
  };

  return { vault, client };
}
