/**
 * Trackit X — Anthropic adapter.
 *
 * Wire format notes:
 *
 *  · `/v1/messages`, and the credential is in the `x-api-key` HEADER — not
 *    `Authorization: Bearer`, which Anthropic does not accept for this API. The
 *    shared `bearerAuth` helper in `base.ts` is therefore deliberately NOT used
 *    here, which is the point of keeping auth inside each adapter: a shared
 *    helper is exactly the thing that would have got this wrong.
 *
 *  · `anthropic-version` is a required header. Without it the API answers 400
 *    with a message that does not mention the missing header.
 *
 *  · System instructions are a TOP-LEVEL `system` string, not a message with
 *    role `system`. A `system` role inside `messages` is rejected.
 *
 *  · `max_tokens` is MANDATORY here — unlike OpenAI, omitting it is a 400. 2048
 *    is a deliberate ceiling on one Copilot answer.
 *
 *  · Usage is `usage.input_tokens` / `output_tokens`; there is no total, so it is
 *    summed rather than read.
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

const PROVIDER: AIProviderId = 'anthropic';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Pinned, not defaulted.
 *
 * Anthropic requires a version on every request and behaviour is versioned, so an
 * unpinned value would mean the app's behaviour could change under it. When
 * Anthropic ships a new version this is a deliberate edit, made by a person who
 * has read the changelog.
 */
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_TOKENS = 2_048;

function headers(credential: SecretMaterial): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': credential,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

function readUsage(body: JsonRecord): AIUsage | undefined {
  const input = readNumber(body, 'usage.input_tokens');
  const output = readNumber(body, 'usage.output_tokens');
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input !== undefined ? { promptTokens: input } : {}),
    ...(output !== undefined ? { completionTokens: output } : {}),
    ...(input !== undefined && output !== undefined ? { totalTokens: input + output } : {}),
  };
}

/**
 * Concatenates the text blocks.
 *
 * `content` is an array of typed blocks, and a response can mix text with tool
 * blocks. Anything that is not a text block is skipped rather than stringified,
 * so a future tool-call response cannot turn a block's JSON into the visible
 * answer.
 */
function readOutputText(body: JsonRecord): string {
  const content = body['content'];
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is JsonRecord => block !== null && typeof block === 'object')
    .filter((block) => block['type'] === 'text')
    .map((block) => readString(block, 'text') ?? '')
    .join('');
}

/** `stop_reason: max_tokens` means the answer was cut off. */
function wasTruncated(body: JsonRecord): boolean {
  return readString(body, 'stop_reason') === 'max_tokens';
}

export const anthropicAdapter: AIProviderAdapter = {
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
      url: MESSAGES_URL,
      headers: headers(credential),
      body: {
        model,
        max_tokens: 16,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      },
    });

    if (!call.ok) {
      return ok({
        provider: PROVIDER,
        model,
        reachable: false,
        latencyMs: call.latencyMs,
        requestId: `anthropic-conn-${call.latencyMs}`,
        failureReason: toConnectionReason(call.failure.kind),
      });
    }

    if (readOutputText(call.body).trim().length === 0) {
      return ok({
        provider: PROVIDER,
        model,
        reachable: false,
        latencyMs: call.latencyMs,
        requestId: `anthropic-conn-${call.latencyMs}`,
        failureReason: 'provider_error',
      });
    }

    return ok({
      provider: PROVIDER,
      model,
      reachable: true,
      latencyMs: call.latencyMs,
      requestId: `anthropic-conn-${call.latencyMs}`,
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
      url: MESSAGES_URL,
      headers: headers(credential),
      body: {
        model: request.model,
        max_tokens: MAX_TOKENS,
        system: request.systemInstructions,
        messages: [{ role: 'user', content: request.userInput }],
      },
    });

    if (!call.ok) return providerFailure<AIResponse>(call.failure);

    const output = readOutputText(call.body);
    if (output.trim().length === 0) {
      return providerFailure<AIResponse>({ kind: 'provider_error', status: call.status });
    }

    if (wasTruncated(call.body)) {
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
      requestId: `anthropic-${call.latencyMs}`,
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
