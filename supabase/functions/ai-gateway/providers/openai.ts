/**
 * Trackit X — OpenAI adapter.
 *
 * Wire format notes:
 *
 *  · `/v1/chat/completions`, bearer auth. The credential is only ever in the
 *    `Authorization` header, never a query parameter, for the same reason as
 *    every other adapter: URLs get logged by things that are not us.
 *
 *  · System instructions are `messages[0]` with `role: "system"`, not a
 *    top-level field. This is the shape most LLM examples share, which is exactly
 *    why it is worth writing down — the other two providers do it differently and
 *    the mapping is where a cross-provider copy/paste breaks.
 *
 *  · Usage is `usage.prompt_tokens` / `completion_tokens` / `total_tokens`.
 *
 *  · The newer `max_completion_tokens` is not universally accepted across the
 *    registry's model line, and `max_tokens` is rejected outright by the
 *    reasoning models that the registry lists. Omitting the cap entirely and
 *    relying on the provider default is the one choice that works across every
 *    model id in the registry, so that is what this does. A per-model cap table is
 *    the right answer once a model is actually observed to need one, and guessing
 *    now would be a 400 on the model nobody tested.
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
  bearerAuth,
  callProvider,
  readNumber,
  readString,
  systemInstructionsAreIntact,
  type JsonRecord,
} from './base.ts';

const PROVIDER: AIProviderId = 'openai';
const COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

function headers(credential: SecretMaterial): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...bearerAuth(credential),
  };
}

function readUsage(body: JsonRecord): AIUsage | undefined {
  const prompt = readNumber(body, 'usage.prompt_tokens');
  const completion = readNumber(body, 'usage.completion_tokens');
  const total = readNumber(body, 'usage.total_tokens');
  if (prompt === undefined && completion === undefined && total === undefined) return undefined;
  return {
    ...(prompt !== undefined ? { promptTokens: prompt } : {}),
    ...(completion !== undefined ? { completionTokens: completion } : {}),
    ...(total !== undefined ? { totalTokens: total } : {}),
  };
}

function readOutputText(body: JsonRecord): string {
  const choices = body['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = (choices[0] as JsonRecord | undefined)?.['message'];
  return readString(message as JsonRecord, 'content') ?? '';
}

/** OpenAI's `finish_reason` for a turn stopped at the length cap. */
function wasTruncated(body: JsonRecord): boolean {
  const choices = body['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const reason = readString(choices[0] as JsonRecord, 'finish_reason');
  return reason === 'length';
}

export const openAiAdapter: AIProviderAdapter = {
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
      url: COMPLETIONS_URL,
      headers: headers(credential),
      body: {
        model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_tokens: 16,
      },
    });

    if (!call.ok) {
      return ok({
        provider: PROVIDER,
        model,
        reachable: false,
        latencyMs: call.latencyMs,
        requestId: `openai-conn-${call.latencyMs}`,
        failureReason: toConnectionReason(call.failure.kind),
      });
    }

    if (readOutputText(call.body).trim().length === 0) {
      return ok({
        provider: PROVIDER,
        model,
        reachable: false,
        latencyMs: call.latencyMs,
        requestId: `openai-conn-${call.latencyMs}`,
        failureReason: 'provider_error',
      });
    }

    return ok({
      provider: PROVIDER,
      model,
      reachable: true,
      latencyMs: call.latencyMs,
      requestId: `openai-conn-${call.latencyMs}`,
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
      url: COMPLETIONS_URL,
      headers: headers(credential),
      body: {
        model: request.model,
        messages: [
          { role: 'system', content: request.systemInstructions },
          { role: 'user', content: request.userInput },
        ],
      },
    });

    if (!call.ok) return providerFailure<AIResponse>(call.failure);

    const output = readOutputText(call.body);
    if (output.trim().length === 0) {
      return providerFailure<AIResponse>({ kind: 'provider_error', status: call.status });
    }

    if (wasTruncated(call.body)) {
      // Surfaced rather than hidden: an answer cut off mid-sentence looks like a
      // complete answer, and a Copilot user acting on half a figure is worse than
      // a visible error.
      return err(
        appError('AI_REQUEST_INVALID', 'The provider stopped at its output limit.', {
          userMessage: 'That answer was too long to finish. Try a narrower question.',
          retryable: false,
          context: { provider: PROVIDER, reason: 'output_truncated' },
        }),
      );
    }

    const usage = readUsage(call.body);

    return ok({
      provider: PROVIDER,
      model: request.model,
      output,
      requestId: `openai-${call.latencyMs}`,
      latencyMs: call.latencyMs,
      ...(usage !== undefined ? { usage } : {}),
    });
  },
};

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
