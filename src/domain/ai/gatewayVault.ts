/**
 * Trackit X — server-side SecretVault port.
 *
 * ── The relationship to `src/services/aiSecretVault.ts` ──────────────────────
 * There are two vaults, and they are not the same interface because they are not
 * the same side of the boundary:
 *
 *   · `AISecretVault` (services) — the CLIENT port. A browser can ask the server
 *     to store a key; it can never read one back. It is implemented, and it
 *     refuses, because there is nowhere safe to put a key yet.
 *   · `SecretVault` (here) — the SERVER port. Implemented by the Edge Function
 *     against Supabase Vault. This is the only code in the repository permitted
 *     to hold a plaintext credential, and it exists only on the server.
 *
 * The client port has no `get`. That asymmetry is the whole design: there is no
 * API surface anywhere in the client bundle that returns a credential, because
 * there is no method that could.
 *
 * ── Why `SecretMaterial` and not `string` ────────────────────────────────────
 * `SecretMaterial` is branded in `gateway.ts`, so a plain string cannot be passed
 * where a credential is expected. The brand is a compile-time marker and erases
 * at build time — it does not encrypt anything. What it buys is that the one
 * place a credential is read is greppable, and that turning a credential back
 * into a string for a function that did not ask for one is a type error rather
 * than a review question.
 *
 * ── Why every method takes `userId` as well as `organizationId` ──────────────
 * The server port is reached with the service role, which bypasses RLS
 * entirely. That is necessary — the gateway has to read `secret_reference` and
 * `vault.secrets`, which no client role may do — and it is also the reason the
 * port cannot be trusted to do its own authorization. So the acting user is
 * passed explicitly and the vault re-checks membership inside the database,
 * against `auth.uid()`-independent facts, on every call.
 *
 * The consequence worth stating plainly: a bug in the Edge Function that skipped
 * the membership check would still be caught by the database function it calls.
 * The privilege boundary is not the TypeScript.
 */
import { appError } from '../../utils/errors.ts';
import { err, type ActionResult } from '../../utils/result.ts';
import type { SecretMaterial } from './gateway.ts';

/** How the gateway reports whether credential storage exists at all. */
export interface SecretVaultAvailability {
  readonly available: boolean;
  /** A sentence safe to render to an administrator. */
  readonly reason: string;
  /** What must be true before this reports `available: true`. */
  readonly requirements: readonly string[];
}

/** The three operations the gateway needs. Deliberately no `list`. */
export interface SecretVault {
  readonly availability: SecretVaultAvailability;

  /**
   * Reads a credential for a provider call.
   *
   * Returns the credential and nothing else — no vault id, no name, no
   * description, no created timestamp. The caller uses it to build one request
   * and must not retain it.
   */
  getProviderCredential(params: {
    readonly userId: string;
    readonly organizationId: string;
    readonly configId: string;
  }): Promise<ActionResult<SecretMaterial>>;

  /**
   * Writes a credential and links it to the configuration.
   *
   * Returns only whether a credential is now stored. The vault handle is written
   * straight to `ai_provider_configs.secret_reference` inside the same database
   * call and is never returned, because a handle is a bearer reference to the
   * secret and has no business in an HTTP response.
   */
  storeProviderCredential(params: {
    readonly userId: string;
    readonly organizationId: string;
    readonly configId: string;
    readonly credential: string;
  }): Promise<ActionResult<{ readonly configId: string; readonly stored: boolean }>>;

  /** Removes the vault entry and clears the reference. */
  deleteProviderCredential(params: {
    readonly userId: string;
    readonly organizationId: string;
    readonly configId: string;
  }): Promise<ActionResult<undefined>>;
}

/** What is still required before a real vault can be used. Shared copy. */
export const SECRET_VAULT_REQUIREMENTS: readonly string[] = [
  'Deploy the ai-gateway Edge Function with the SUPABASE_SERVICE_ROLE_KEY in its server environment.',
  'Never set that key with an EXPO_PUBLIC_ prefix; those are inlined into the client bundle.',
  'Keep Supabase Vault enabled for the project so vault.secrets exists and vault.create_secret is executable by service_role.',
  'Restrict the gateway function so only a signed-in member of the configuration organization can reach it.',
];

/**
 * The message the gateway returns when storage is missing.
 *
 * The exact sentence named in the Phase 36 plan, and it is chosen over anything
 * more specific on purpose: a caller learns that credentials are not configured
 * and nothing about why, whether the vault is absent, the function is undeployed,
 * or the lookup found no row. Those are three different operational problems and
 * a client is the wrong place to be told which one it is.
 */
export const CREDENTIALS_NOT_CONFIGURED_MESSAGE = 'AI provider credentials are not configured.';

function notConfigured(
  reason: string,
  logContext: Record<string, string> = {},
): ReturnType<typeof err> {
  return err(
    appError('AI_PROVIDER_NOT_CONFIGURED', `Vault unavailable: ${reason}.`, {
      userMessage: CREDENTIALS_NOT_CONFIGURED_MESSAGE,
      retryable: false,
      context: logContext,
    }),
  );
}

/**
 * The port, before a vault exists.
 *
 * Ships so the gateway can be written, deployed and security-tested against a
 * real database with no vault behind it — every call fails safely, and the
 * failure is the same one a real vault returns when it holds no matching entry.
 * That is a deliberate choice: an implementation that reported "success" here
 * would let a deployment look configured when it is not, and the first person to
 * notice would be a user whose provider calls were silently going nowhere.
 */
export const unavailableSecretVault: SecretVault = {
  availability: {
    available: false,
    reason:
      'No server-side secret store is reachable from the gateway. Provider credentials cannot be stored or read.',
    requirements: SECRET_VAULT_REQUIREMENTS,
  },

  async getProviderCredential(): Promise<ActionResult<SecretMaterial>> {
    return notConfigured('no vault reachable');
  },

  async storeProviderCredential(): Promise<
    ActionResult<{ readonly configId: string; readonly stored: boolean }>
  > {
    return notConfigured('no vault reachable');
  },

  async deleteProviderCredential(): Promise<ActionResult<undefined>> {
    return notConfigured('no vault reachable');
  },
};

/**
 * Casts a plaintext string to `SecretMaterial`.
 *
 * The only correct call site is immediately after a successful vault read, in the
 * vault adapter. It is exported rather than inlined so that a second call site is
 * a visible, greppable decision instead of a silent widening of where a
 * credential can be treated as one.
 */
export function toSecretMaterial(plaintext: string): SecretMaterial {
  return plaintext as SecretMaterial;
}

/** Reports whether a value is usable as a credential without inspecting it. */
export function isUsableSecretMaterial(value: unknown): value is SecretMaterial {
  return typeof value === 'string' && value.length > 0;
}

/** Convenience for a handler that needs to branch on availability. */
export function vaultUnavailableReason(vault: SecretVault): string {
  return vault.availability.available ? '' : vault.availability.reason;
}
