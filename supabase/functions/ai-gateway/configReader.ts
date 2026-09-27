/**
 * Trackit X — provider configuration reader.
 *
 * A single function, because the rule it exists to enforce is one sentence: the
 * gateway reads `ai_provider_configs` through the Phase 36 RPC and through nothing
 * else. There is no PostgREST table query anywhere in this function's directory,
 * and that is not an oversight — `service_role` holds no table privilege on that
 * table by design, so a direct query fails with `permission denied` and
 * `BYPASSRLS` does not help because it only bypasses row policies.
 *
 * Adding a `.from('ai_provider_configs')` call anywhere in the Edge Function would
 * require granting `service_role` SELECT, which would hand the function an
 * unguarded read of every organization's `secret_reference` with membership
 * checked only in TypeScript. This module is the boundary that keeps that from
 * being a two-line change.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { err, ok, type ActionResult } from '../../../src/utils/result.ts';
import { appError } from '../../../src/utils/errors.ts';
import { logGateway } from './http.ts';

/** The columns `ai_gateway_read_config` returns. Mirrors the SQL `returns table`. */
export interface AIProviderConfigFactsRow {
  readonly id: string;
  readonly organization_id: string;
  /** `public.ai_provider`, which is a Postgres enum and arrives as a string. */
  readonly provider: string;
  readonly display_name: string;
  readonly enabled: boolean;
  readonly is_default: boolean;
  readonly selected_model: string;
  readonly credential_present: boolean;
  readonly connection_status: string;
}

/**
 * Reads one configuration's safe metadata for one actor.
 *
 * @param client A service-role client. The RPC, not this function, checks that
 *   `actorId` is a member of the configuration's organization, and that the
 *   caller is the service role. Passing an actor id that is not a member returns
 *   the same 42501 as passing a configuration id that does not exist, so this
 *   function cannot be used to probe for either.
 */
export async function readProviderConfig(
  client: SupabaseClient,
  actorId: string,
  configId: string,
): Promise<ActionResult<AIProviderConfigFactsRow>> {
  const { data, error } = await client.rpc('ai_gateway_read_config', {
    p_actor_id: actorId,
    p_config_id: configId,
  });

  if (error !== null) {
    // 42501 covers not-a-member, not-service-role and no-such-row identically, by
    // design. Nothing in this log line distinguishes them, so nothing in a log
    // collector can either.
    logGateway('warn', 'config_read_refused', {
      configId,
      sqlstate: error.code ?? 'none',
    });

    return err(
      appError('AI_UNAUTHORIZED', 'Configuration read refused.', {
        userMessage: 'You are not allowed to use this AI provider configuration.',
        retryable: false,
        context: { sqlstate: error.code ?? 'none' },
      }),
    );
  }

  const row = firstRow(data);
  if (row === null) {
    // The function returns a row set; an empty set means the configuration was
    // deleted between the request arriving and this call. Treated as a refusal.
    return err(
      appError('AI_UNAUTHORIZED', 'Configuration read returned no row.', {
        userMessage: 'You are not allowed to use this AI provider configuration.',
        retryable: false,
      }),
    );
  }

  return ok(row);
}

/** PostgREST returns a set as an array; the RPC declares a single row. */
function firstRow(data: unknown): AIProviderConfigFactsRow | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const candidate = data[0];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  return candidate as AIProviderConfigFactsRow;
}
