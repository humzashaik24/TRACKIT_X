/**
 * Trackit X — server-side secret vault port.
 *
 * ── The one rule ─────────────────────────────────────────────────────────────
 * A provider credential enters the application exactly once, as a string typed
 * into a password field, and leaves it only by being handed to a server-side
 * vault. It is never persisted, never logged, never put in a request the browser
 * can read back, and never used to derive anything the browser can see.
 *
 * ── Why this port has no working implementation ───────────────────────────────
 * Trackit X is a static client bundle. There is no server runtime, so there is
 * nowhere to put a key that the browser could not also reach. Rather than
 * invent a local substitute — `expo-secure-store`, an encrypted localStorage
 * entry, a hardcoded key — this port ships unimplemented and says so.
 *
 * That is the correct outcome for a security boundary, not a gap to paper over.
 * The alternative would look finished and be wrong: a credential stored on the
 * device is extractable from a compromised device, is not revocable centrally,
 * and does not survive a user switching devices.
 *
 * ── What an implementation must do ───────────────────────────────────────────
 *  1. Run on the server, with the vault credentials in server environment
 *     variables — never `EXPO_PUBLIC_*`, which are inlined into the bundle.
 *  2. Authorise the caller as an admin of the organization named in the row,
 *     resolving that organization from the caller's own membership.
 *  3. Write the credential to the vault, then store only the returned opaque
 *     handle in `ai_provider_configs.secret_reference`.
 *  4. Never return the credential, or any part of it, in a response body.
 *  5. Never write it to a log. `redact` in `src/utils/redact.ts` is a safety net,
 *     not permission to pass a key to the logger.
 */
import { isSensitiveKey } from '@/utils/redact';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { err, ok, type ActionResult } from '@/utils/result';
import type { AIProviderId } from '@/domain/ai/types';

const log = logger.child({ module: 'aiSecretVault' });

/** Longest credential any supported provider issues. Well above every real one. */
export const MAX_CREDENTIAL_LENGTH = 512;
export const MIN_CREDENTIAL_LENGTH = 8;

export interface CredentialSubmission {
  readonly organizationId: string;
  readonly provider: AIProviderId;
  /**
   * The plaintext credential, exactly as typed.
   *
   * Deliberately not `readonly`-protected against being copied: no TypeScript
   * type can stop a string being duplicated, and pretending otherwise would be
   * worse than saying it plainly. What this type buys is that the field is named,
   * so a reader can see exactly where plaintext is permitted to exist, and the
   * only two call sites are the vault port and the UI's transient form state.
   */
  readonly credential: string;
}

export interface StoredCredential {
  /** `ai_provider_configs.id`. The only identifier the client ever holds. */
  readonly configId: string;
  readonly storedAt: string;
}

export interface SecretVaultAvailability {
  /** False until a server-side vault is deployed and reachable. */
  readonly available: boolean;
  /** A sentence explaining the current state, safe to show an administrator. */
  readonly reason: string;
  /** What is still required before this can report `available: true`. */
  readonly requirements: readonly string[];
}

export interface AISecretVault {
  readonly availability: SecretVaultAvailability;
  /** Hands a credential to the server-side vault. Never returns it. */
  store(submission: CredentialSubmission): Promise<ActionResult<StoredCredential>>;
  /** Deletes the vault entry. The handle is removed with it. */
  revoke(configId: string): Promise<ActionResult<undefined>>;
}

/**
 * The port, before a server exists.
 *
 * Every method refuses. It does not store the credential anywhere, does not
 * generate a fake handle, and does not report the provider as configured — which
 * means a provider configured against this vault correctly shows as
 * "Not configured" rather than claiming a credential it never received.
 */
export const secretVault: AISecretVault = {
  availability: {
    available: false,
    reason:
      'No secure server-side secret store is deployed. Trackit X is a static client, so a provider credential has nowhere safe to go.',
    requirements: [
      'Deploy an AI Gateway (Supabase Edge Function or equivalent) with a server runtime.',
      'Back the vault with Supabase Vault, or an external secret manager reachable from that runtime.',
      'Hold the vault credentials in server environment variables, never EXPO_PUBLIC_* ones.',
      'Implement store() and revoke() against that vault, returning only an opaque handle.',
    ],
  },

  async store(): Promise<ActionResult<StoredCredential>> {
    log.warn('Credential submission refused: no server-side secret store is deployed', {
      reason: 'vault_unavailable',
    });
    return err(
      appError(
        'AI_UNAVAILABLE',
        'Credential submission requires a server-side vault, which is not deployed.',
        {
          userMessage:
            'API keys cannot be saved yet. Trackit X needs its secure server vault before a provider key can be stored.',
          retryable: false,
          context: { reason: 'vault_unavailable' },
        },
      ),
    );
  },

  async revoke(): Promise<ActionResult<undefined>> {
    log.warn('Credential revocation refused: no server-side secret store is deployed', {
      reason: 'vault_unavailable',
    });
    return err(
      appError('AI_UNAVAILABLE', 'Credential revocation requires a server-side vault.', {
        userMessage: 'Stored API keys cannot be removed yet.',
        retryable: false,
        context: { reason: 'vault_unavailable' },
      }),
    );
  },
};

/**
 * Rejects a credential before it is handed anywhere.
 *
 * Length only. There is no shape check, because each provider issues a different
 * shape and a regex that accepts one provider's key while rejecting another's is
 * a worse failure than accepting a key the provider will reject. Nothing here
 * inspects or reports the value.
 */
export function validateCredentialFormat(credential: string): ActionResult<string> {
  const trimmed = credential.trim();
  if (trimmed.length < MIN_CREDENTIAL_LENGTH) {
    return err(
      appError('VALIDATION_FAILED', 'Credential failed the minimum length check.', {
        userMessage: 'That does not look like a complete API key.',
        context: { reason: 'too_short' },
      }),
    );
  }
  if (trimmed.length > MAX_CREDENTIAL_LENGTH) {
    return err(
      appError('VALIDATION_FAILED', 'Credential exceeded the maximum accepted length.', {
        userMessage: 'That is longer than any provider API key. Check for pasted extra text.',
        context: { reason: 'too_long' },
      }),
    );
  }
  return ok(trimmed);
}

/**
 * Last-line guard against writing a credential into the database.
 *
 * Called with every payload on its way to `ai_provider_configs`. It inspects
 * *field names* only — never values — so it cannot itself leak the thing it is
 * looking for, and it is cheap enough to leave on in production.
 *
 * This is deliberately paranoid. The column grants in the migration already make
 * a credential column unwritable by the client role; this catches the mistake
 * where someone later adds a `api_key` column and a service that fills it.
 */
export function assertNoCredentialFields(payload: Readonly<Record<string, unknown>>): ActionResult<true> {
  const offending = Object.keys(payload).find((key) => isSensitiveKey(key) && key !== 'display_name');
  if (offending !== undefined) {
    return err(
      appError('PERMISSION_DENIED', 'Refused to persist a payload carrying a credential-shaped field.', {
        userMessage: 'That change could not be saved safely.',
        context: { reason: 'credential_field_refused', field: offending },
      }),
    );
  }
  return ok(true);
}
