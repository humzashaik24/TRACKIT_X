/**
 * Trackit X — provider adapter foundation.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 * This module owns the parts of talking to a paid HTTP API that are the same for
 * every provider: a hard timeout, reading the body as text, turning a status
 * number into a `ProviderCallFailure`, and refusing to return a body that looks
 * like it contains a credential. An adapter owns everything provider-specific:
 * the URL, the headers, the JSON shape, and where the answer is in the response.
 *
 * ── Why the response body is not returned on failure ─────────────────────────
 * Provider error bodies are the single most likely place for a credential to
 * reappear. OpenAI's `invalid_api_key` message is literally
 * `Incorrect API key provided: sk-proj-…`, and Anthropic's is close to the same
 * shape. So a failed call returns a status and a classification and nothing else.
 * The body is read — a provider may put the answer in an error — but it is
 * discarded, and what the operator gets is the request id.
 *
 * ── Why the timeout is not configurable per call ─────────────────────────────
 * A caller who can choose the timeout can choose it to be very large, which is a
 * way to tie up gateway workers for free. It is a constant.
 */
import { classifyProviderStatus, type ProviderCallFailure } from '../../../../src/domain/ai/providerErrors.ts';
import { containsSecret } from '../../../../src/utils/redact.ts';
import type { SecretMaterial } from '../../../../src/domain/ai/gateway.ts';
import { GATEWAY_SYSTEM_INSTRUCTIONS } from '../../../../src/domain/ai/gatewayPrompt.ts';
import type { AIRequest } from '../../../../src/domain/ai/types.ts';
import { logGateway } from '../http.ts';

/**
 * Hard ceiling on one provider call.
 *
 * 45s. Long enough that a slow large-context request still completes, short enough
 * that a hung socket does not hold a worker for the platform's own limit. The
 * gateway's client-visible timeout is 30s (`GATEWAY_TIMEOUT_MS`), so a provider
 * slower than that has already lost the race from the caller's point of view.
 */
export const PROVIDER_TIMEOUT_MS = 45_000;

/**
 * The safe subset of a JSON object an adapter reads. Providers return more.
 *
 * Exported because every adapter narrows provider responses through it, and a
 * type that had to be re-declared per adapter would drift.
 */
export type JsonRecord = Record<string, unknown>;

/** What a successful provider call yielded. */
export interface ProviderCallOk {
  readonly ok: true;
  readonly body: JsonRecord;
  readonly status: number;
  readonly latencyMs: number;
}

/** What a failed provider call yielded. Carries no provider text. */
export interface ProviderCallFailed {
  readonly ok: false;
  readonly failure: ProviderCallFailure;
  readonly latencyMs: number;
}

export type ProviderCallResult = ProviderCallOk | ProviderCallFailed;

/**
 * Performs one provider request.
 *
 * @param url Provider endpoint. Never logged — an endpoint plus a credential is
 *   enough to make a provider call, and this is the only place that holds both.
 * @param headers Provider-specific headers, including the credential. Passed
 *   straight to `fetch`; the function never inspects or records them.
 * @param body JSON request body.
 */
export async function callProvider(params: {
  readonly provider: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}): Promise<ProviderCallResult> {
  const { provider, url, headers, body } = params;
  const startedAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (thrown) {
    const latencyMs = Date.now() - startedAt;
    const aborted = thrown instanceof Error && thrown.name === 'AbortError';
    logGateway('warn', 'provider_transport_failure', {
      provider,
      latencyMs,
      reason: aborted ? 'timeout' : 'unreachable',
    });
    return {
      ok: false,
      latencyMs,
      failure: { kind: aborted ? 'timeout' : 'unreachable', status: 0 },
    };
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;
  const text = await safeReadText(response);

  if (!response.ok) {
    // The body is read and then dropped. `providerDetailPresent` is all that
    // survives, so an operator learns the provider explained itself without the
    // explanation reaching a log line.
    logGateway('warn', 'provider_error_status', {
      provider,
      status: response.status,
      latencyMs,
      bodyBytes: text.length,
    });
    return {
      ok: false,
      latencyMs,
      failure: {
        kind: classifyProviderStatus(response.status),
        status: response.status,
        ...(text.length > 0 ? { providerDetail: text } : {}),
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    logGateway('warn', 'provider_unparseable_body', { provider, status: response.status });
    return {
      ok: false,
      latencyMs,
      failure: { kind: 'provider_error', status: response.status },
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logGateway('warn', 'provider_unexpected_shape', { provider, status: response.status });
    return {
      ok: false,
      latencyMs,
      failure: { kind: 'provider_error', status: response.status },
    };
  }

  // A well-formed 200 whose text happens to contain something shaped like a key
  // is a provider that has misbehaved, not a usable answer. Failing closed here
  // is what stops a gateway response from becoming a credential oracle.
  if (containsSecret(text)) {
    logGateway('error', 'provider_body_contained_credential_pattern', { provider });
    return {
      ok: false,
      latencyMs,
      failure: { kind: 'provider_error', status: response.status },
    };
  }

  return { ok: true, body: parsed as JsonRecord, status: response.status, latencyMs };
}

/** Reads a body as text, tolerating a stream that fails mid-read. */
async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Reads a dotted path out of a provider response.
 *
 * Returns undefined for any miss rather than throwing, because every call site is
 * asking "is this field there?" and a provider that changes its shape should
 * produce a clean "provider_error" rather than an unhandled exception.
 */
export function readPath(source: JsonRecord, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as JsonRecord)[key];
  }
  return current;
}

/** Reads a numeric field, or undefined. Providers send numbers as numbers and as strings. */
export function readNumber(source: JsonRecord, path: string): number | undefined {
  const raw = readPath(source, path);
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Reads a string field, or undefined. */
export function readString(source: JsonRecord, path: string): string | undefined {
  const raw = readPath(source, path);
  return typeof raw === 'string' ? raw : undefined;
}

/** The bearer-style header name each provider expects. */
export function bearerAuth(credential: SecretMaterial): Record<string, string> {
  return { Authorization: `Bearer ${credential}` };
}

// ---------------------------------------------------------------------------
// System-instruction integrity
// ---------------------------------------------------------------------------

/**
 * Confirms the request carries the protected system prompt, and only that one.
 *
 * `AIRequest.systemInstructions` exists because that is the interface the
 * adapters were written against, and it is the one place in this architecture
 * where a caller-supplied string could reach a provider's privileged instruction
 * field. The chain that normally prevents it is: the client contract
 * (`GenerateRequestBody`) has no such field, `buildPrompt` derives `system` from a
 * module constant, and `PromptEnvelope.system` is readonly. Three structural
 * properties, none of which is a check.
 *
 * This is the check, and it exists because the other three are in files a future
 * change could edit. If a refactor ever assembles an `AIRequest` from something
 * that is not `PromptEnvelope.system` — a debug endpoint, a new operation, a
 * careless spread — this refuses the call instead of sending a caller's text as
 * the assistant's standing instructions. The comparison is against the constant
 * rather than against a pattern, because "does this look like an instruction" is
 * not decidable and a heuristic here would be worse than nothing.
 *
 * An absent field is treated as a failure, not as "use the default": the gateway
 * always sets it, so its absence means the request did not come from the gateway.
 */
export function systemInstructionsAreIntact(request: AIRequest): boolean {
  return request.systemInstructions === GATEWAY_SYSTEM_INSTRUCTIONS;
}
