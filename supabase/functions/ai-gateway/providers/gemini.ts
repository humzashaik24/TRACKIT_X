/**
 * Trackit X — Google Gemini adapter.
 *
 * Wire format notes that are not obvious and cost real time to rediscover:
 *
 *  · The credential goes in the `x-goog-api-key` HEADER, not the `?key=` query
 *    parameter that appears first in Google's own examples. The query form puts
 *    the key in the URL, and a URL is the one part of an HTTP request that
 *    intermediaries, proxies, CDN logs and error trackers all keep. The header
 *    form is supported by the same API and does not.
 *
 *  · System instructions are a TOP-LEVEL `system_instruction` field, not a
 *    message with role `system`. A `messages`-style role is not accepted, so
 *    mapping this onto the common chat shape does not compile against the real
 *    schema and produces a 400 that reads like a bad key.
 *
 *  · Token usage is `usageMetadata` with `promptTokenCount` /
 *    `candidatesTokenCount` / `totalTokenCount` — camelCase, and under a
 *    different parent than the `models` object suggests.
 *
 *  · The model id in the registry is what goes in the path. Gemini has no
 *    `model` field in the body; the model IS the endpoint.
 */
import { err, ok, type ActionResult } from '../../../../src/utils/result.ts';
import { appError } from '../../../../src/utils/errors.ts';
import { providerFailure } from '../../../../src/domain/ai/providerErrors.ts';
import { buildConnectionTestPrompt } from '../../../../src/domain/ai/gatewayPrompt.ts';
import { getProviderDefinition } from '../../../../src/domain/ai/registry.ts';
import type {
  AIConnectionFailureReason,
  AIProviderAdapter,
  ConnectionTestReport,
 SecretMaterial } from '../../../../src/domain/ai/gateway.ts';
import type {
  AIModelDefinition,
  AIProviderId,
  AIRequest,
  AIResponse,
  AIUsage,
} from '../../../../src/domain/ai/types.ts';
import {
  callProvider,
  readNumber,
  readString,
  systemInstructionsAreIntact,
  type JsonRecord,
} from './base.ts';

const PROVIDER: AIProviderId = 'gemini';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Upper bound on a generated answer. Keeps an accidental runaway bill bounded. */
const MAX_OUTPUT_TOKENS = 2_048;

function endpointFor(model: string): string {
  // The model id is interpolated into a path. It is not caller-supplied — the
  // gateway resolves it through the registry before constructing an adapter — but
  // it is encoded anyway, because a model id that reached this point unvalidated
  // would be able to rewrite the path.
  return `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
}

function headers(credential: SecretMaterial): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': credential,
  };
}

/** Gemini's own `finishReason`, reduced to our vocabulary. */
function mapFinishReason(body: JsonRecord): { blocked: boolean } {
  const reason = readString(body, 'promptFeedback.blockReason');
  return { blocked: reason !== undefined };
}

function readUsage(body: JsonRecord): AIUsage | undefined {
  const prompt = readNumber(body, 'usageMetadata.promptTokenCount');
  const completion = readNumber(body, 'usageMetadata.candidatesTokenCount');
  const total = readNumber(body, 'usageMetadata.totalTokenCount');
  if (prompt === undefined && completion === undefined && total === undefined) return undefined;
  return {
    ...(prompt !== undefined ? { promptTokens: prompt } : {}),
    ...(completion !== undefined ? { completionTokens: completion } : {}),
    ...(total !== undefined ? { totalTokens: total } : {}),
  };
}

/** Concatenates the text parts of the first candidate. */
function readOutputText(body: JsonRecord): string {
  const candidates = body['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const parts = (candidates[0] as JsonRecord | undefined)?.['content'];
  const partList = (parts as JsonRecord | undefined)?.['parts'];
  if (!Array.isArray(partList)) return '';
  return partList
    .map((part) => (part as JsonRecord | undefined)?.['text'])
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

export const geminiAdapter: AIProviderAdapter = {
  provider: PROVIDER,

  listSupportedModels(): readonly AIModelDefinition[] {
    return getProviderDefinition(PROVIDER)?.models ?? [];
  },

  async testConnection(
    credential: SecretMaterial,
    model: string,
  ): Promise<ActionResult<ConnectionTestReport>> {
    const prompt = buildConnectionTestPrompt(model);

    const call = await callProvider({
      provider: PROVIDER,
      url: endpointFor(model),
      headers: headers(credential),
      body: {
        system_instruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: { maxOutputTokens: 16 },
      },
    });

    if (!call.ok) {
      const reason = toConnectionReason(call.failure.kind);
      return ok({
        provider: PROVIDER,
        model,
        reachable: false,
        latencyMs: call.latencyMs,
        requestId: `gemini-conn-${call.latencyMs}`,
        failureReason: reason,
      });
    }

    // A 200 that contains no text is a connection that did not actually prove the
    // credential works, and reporting it as `reachable` would put "Connected" in
    // front of an administrator who cannot generate. Treated as a failure.
    if (readOutputText(call.body).trim().length === 0) {
      return ok({
        provider: PROVIDER,
        model,
        reachable: false,
        latencyMs: call.latencyMs,
        requestId: `gemini-conn-${call.latencyMs}`,
        failureReason: 'provider_error',
      });
    }

    return ok({
      provider: PROVIDER,
      model,
      reachable: true,
      latencyMs: call.latencyMs,
      requestId: `gemini-conn-${call.latencyMs}`,
      failureReason: null,
    });
  },

  async generate(
    credential: SecretMaterial,
    request: AIRequest,
  ): Promise<ActionResult<AIResponse>> {
    if (!systemInstructionsAreIntact(request)) {
      return err(
        appError('AI_REQUEST_INVALID', 'Refused a request whose system instructions are not the protected prompt.', {
          userMessage: 'The request could not be understood.',
          retryable: false,
          context: { provider: PROVIDER, reason: 'system_instructions_not_intact' },
        }),
      );
    }

    const call = await callProvider({
      provider: PROVIDER,
      url: endpointFor(request.model),
      headers: headers(credential),
      body: {
        system_instruction: { parts: [{ text: request.systemInstructions }] },
        contents: [{ role: 'user', parts: [{ text: request.userInput }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      },
    });

    if (!call.ok) return providerFailure<AIResponse>(call.failure);

    const { blocked } = mapFinishReason(call.body);
    if (blocked) {
      return err(
        appError('AI_REQUEST_INVALID', 'The provider refused this prompt.', {
          userMessage: 'The AI provider could not answer that question.',
          retryable: false,
          context: { provider: PROVIDER, reason: 'prompt_blocked' },
        }),
      );
    }

    const output = readOutputText(call.body);
    if (output.trim().length === 0) {
      return providerFailure<AIResponse>({ kind: 'provider_error', status: call.status });
    }

    const usage = readUsage(call.body);

    return ok({
      provider: PROVIDER,
      model: request.model,
      output,
      requestId: `gemini-${call.latencyMs}`,
      latencyMs: call.latencyMs,
      ...(usage !== undefined ? { usage } : {}),
    });
  },
};

/** Adapter failure kind to the report vocabulary the Settings screen understands. */
function toConnectionReason(kind: string): AIConnectionFailureReason {
  switch (kind) {
    case 'credentials_rejected':
      return 'credentials_rejected';
    case 'timeout':
      return 'timeout';
    case 'unreachable':
      return 'provider_unreachable';
    default:
      return 'provider_error';
  }
}
