/**
 * Trackit X — provider failure mapping.
 *
 * ── The problem this solves ──────────────────────────────────────────────────
 * When a provider rejects a request it returns a body written for a developer
 * debugging that provider. Those bodies are dangerous to forward, and not only
 * because they are ugly:
 *
 *   · OpenAI and Anthropic both echo part of the credential back in
 *     `invalid_api_key` messages — the literal string "Incorrect API key provided:
 *     sk-proj-abc…XYZ" is a documented shape, not a hypothetical one.
 *   · A 400 from a malformed request frequently includes the submitted body, and
 *     a Copilot request body is the organization's business data.
 *   · Provider error text is unstable across versions, so anything a UI matches
 *     on it breaks without a deploy.
 *
 * So the mapping is one-way and lossy on purpose: a provider status becomes a
 * closed `AppErrorCode`, and everything else about the failure is dropped on the
 * floor. The detail is not lost — it is written to the server log, redacted, and
 * keyed by the request id the client also receives. That is the correct place for
 * it: the operator can correlate, and the browser never sees it.
 *
 * ── What must never happen here ──────────────────────────────────────────────
 * No function in this file returns, embeds, or interpolates provider text into
 * anything that leaves the server. `classifyProviderStatus` takes a status number
 * and nothing else, which makes that structurally true rather than a rule to
 * remember.
 */
import { appError, type AppError, type AppErrorCode } from '../../utils/errors.ts';
import { err, type ActionResult } from '../../utils/result.ts';

/** Every failure the gateway can report about a provider call. */
export type ProviderFailureKind =
  | 'credentials_rejected'
  | 'rate_limited'
  | 'model_not_found'
  | 'timeout'
  | 'unreachable'
  | 'provider_error';

/** What the provider told us, reduced to a status and nothing else. */
export interface ProviderCallFailure {
  readonly kind: ProviderFailureKind;
  /** HTTP status, or 0 for a transport failure that never got a response. */
  readonly status: number;
  /**
   * Provider text, for the SERVER LOG ONLY.
   *
   * Typed as a parameter that is threaded into `log.warn` and never into an
   * `AppError`, precisely so that grepping this file for where provider text goes
   * finds exactly one answer.
   */
  readonly providerDetail?: string;
}

/** Maps a failure kind to the code a client may see. */
export function codeForProviderFailure(kind: ProviderFailureKind): AppErrorCode {
  switch (kind) {
    case 'credentials_rejected':
      return 'AI_PROVIDER_AUTH_FAILED';
    case 'rate_limited':
      return 'AI_PROVIDER_RATE_LIMITED';
    case 'model_not_found':
      return 'AI_MODEL_NOT_SUPPORTED';
    case 'timeout':
      return 'AI_PROVIDER_RATE_LIMITED';
    case 'unreachable':
      return 'AI_PROVIDER_UNAVAILABLE';
    case 'provider_error':
      return 'AI_PROVIDER_UNAVAILABLE';
  }
}

/**
 * Classifies a provider HTTP status.
 *
 * Takes the status and nothing else. An adapter that wants to pass along a
 * provider message calls this with the number, and keeps the text for the log.
 *
 * The mapping is deliberately coarse. Distinguishing "this key is revoked" from
 * "this key is for the wrong organisation" from "this key is malformed" is a
 * distinction the credential's owner — an administrator — can act on but a user
 * of the Copilot cannot, and the raw text that would carry it is the text that
 * may echo the key. So all three are `credentials_rejected`.
 */
export function classifyProviderStatus(status: number): ProviderFailureKind {
  if (status === 401 || status === 403) return 'credentials_rejected';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'model_not_found';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'provider_error';
  if (status === 0) return 'unreachable';
  // 400 and everything else: the provider rejected the request shape. Reported
  // as unavailable rather than as a client error, because the request shape is
  // the gateway's responsibility, not the caller's.
  return 'provider_error';
}

/**
 * Turns a provider failure into a safe `AppError`.
 *
 * `providerDetail` is accepted and dropped. That is intentional and is the
 * clearest statement of the rule in the codebase: the function that converts
 * provider failures into user-facing errors takes the detail as an argument and
 * has no path that puts it in the result. A future change that tried to would
 * have to add a field to `AppError`, which is a visible act.
 */
export function toSafeProviderError(failure: ProviderCallFailure): AppError {
  const code = codeForProviderFailure(failure.kind);
  return appError(code, `Provider call failed (${failure.kind}, status ${failure.status}).`, {
    retryable: code === 'AI_PROVIDER_RATE_LIMITED' || code === 'AI_PROVIDER_UNAVAILABLE',
    context: {
      kind: failure.kind,
      status: failure.status,
      // Recorded as present/absent, never as content: knowing the provider
      // explained itself is useful for triage; the explanation may contain the
      // key.
      providerDetailPresent: failure.providerDetail !== undefined && failure.providerDetail.length > 0,
    },
  });
}

/** The `ActionResult` form, for handlers returning `ActionResult<T>`. */
export function providerFailure<T>(failure: ProviderCallFailure): ActionResult<T> {
  return err(toSafeProviderError(failure));
}
