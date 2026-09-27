/**
 * Trackit X — redaction.
 *
 * The single rule this file enforces: a secret must never reach a log sink, a
 * crash report, or an error message. Relying on "don't log that" as a convention
 * fails the first time someone logs a whole request object, so redaction is
 * applied automatically to everything on its way out.
 *
 * Two independent passes, because either alone has a blind spot:
 *
 *  · By KEY — a field named `password`, `access_token`, `apiKey`… is redacted
 *    whatever it contains. Catches the common case.
 *  · By VALUE — a string shaped like a JWT, a Supabase secret key, a Google API
 *    key or a bearer header is redacted whatever it is called. Catches the case
 *    where a secret is nested in a field named `data`, `body` or `1`.
 *
 * Key matching tokenises rather than substring-matching, which matters more than
 * it sounds: a plain `includes('pin')` redacts every `shipping` field in an
 * inventory system, and `includes('auth')` redacts `authorName`. Over-redaction
 * that hides ordinary business data makes logs useless, so the match is precise
 * on short words and only loose on fragments long enough to be unambiguous.
 */

export const REDACTED = '[redacted]';

/**
 * Whole tokens that mark a field as sensitive. Compared against the key split
 * on camelCase and separator boundaries, so `refreshToken`, `refresh_token` and
 * `REFRESH-TOKEN` all match while `authorName` and `shipping` do not.
 */
const sensitiveTokens: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'tokens',
  'jwt',
  'bearer',
  'auth',
  'authorization',
  'credential',
  'credentials',
  'cookie',
  'cookies',
  'session',
  'otp',
  'pin',
  'passcode',
  'signature',
  'salt',
  'hash',
  'nonce',
  // Personal and financial identifiers: not credentials, but they do not belong
  // in a log line either.
  'ssn',
  'nin',
  'iban',
  'cvv',
  'cvc',
  'aadhaar',
  'pan',
]);

/**
 * Tokens that are only sensitive as the tail of a compound — `apiKey`,
 * `serviceRoleKey`, `encryptionKey` — because a bare `key` is far more often a
 * map key, a sort key or a React key than a credential.
 */
const keyQualifiers: ReadonlySet<string> = new Set([
  'api',
  'secret',
  'private',
  'public',
  'service',
  'servicerole',
  'access',
  'refresh',
  'publishable',
  'anon',
  'encryption',
  'signing',
  'license',
  'licence',
]);

/**
 * Fragments long enough that a substring match cannot plausibly collide with a
 * business term. This is the safety net for keys that arrive with no boundaries
 * at all, like `accesstoken` or `xapikey`.
 */
const sensitiveFragments: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'credential',
  'privatekey',
  'servicerole',
  'clientsecret',
  'sessionid',
  'taxid',
  'accountnumber',
  'cardnumber',
  'routingnumber',
];

/**
 * Value shapes that are secrets regardless of the field they arrive in.
 *
 * Kept narrow on purpose — a pattern loose enough to match any long string would
 * redact ordinary text and make logs useless.
 */
const sensitiveValuePatterns: readonly RegExp[] = [
  // JWT: three base64url segments. Supabase access/refresh tokens and the
  // legacy anon/service keys all take this shape.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/,
  // Supabase's newer prefixed keys.
  /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/,
  // Google / Gemini API keys.
  /\bAIza[0-9A-Za-z_-]{20,}/,
  // OpenAI project keys, and legacy OpenAI keys. The length floor keeps a word
  // that merely starts "sk" from being treated as a credential.
  /\bsk-proj-[0-9A-Za-z_-]{16,}/,
  /\bsk-[0-9A-Za-z]{32,}\b/,
  // Anthropic API keys.
  /\bsk-ant-[0-9A-Za-z_-]{16,}/,
  // An Authorization header pasted in whole.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  // A postgres connection string, which embeds the database password.
  /\bpostgres(ql)?:\/\/[^\s]*:[^\s@]*@/i,
  // Basic-auth credentials in any URL.
  /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  // A PEM private key block.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** Guards against a pathological or cyclic object turning a log call into a hang. */
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;

/** Splits a key into lowercase words on separators and camelCase transitions. */
export function tokeniseKey(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  const tokens = tokeniseKey(key);

  if (tokens.some((token) => sensitiveTokens.has(token))) return true;

  // `key` on its own is innocent; qualified, it is a credential.
  const keyIndex = tokens.lastIndexOf('key');
  if (keyIndex > 0) {
    const qualifier = tokens[keyIndex - 1];
    if (qualifier !== undefined && keyQualifiers.has(qualifier)) return true;
  }

  const squashed = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sensitiveFragments.some((fragment) => squashed.includes(fragment));
}

export function containsSecret(value: string): boolean {
  return sensitiveValuePatterns.some((pattern) => pattern.test(value));
}

/** Redacts a string by value shape, and truncates anything unreasonably long. */
function redactString(value: string): string {
  if (containsSecret(value)) return REDACTED;
  if (value.length > MAX_STRING_LENGTH) {
    const dropped = value.length - MAX_STRING_LENGTH;
    return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${dropped} chars]`;
  }
  return value;
}

/**
 * Returns a copy of `value` safe to serialise into a log.
 *
 * Errors are reduced to their identifying fields; functions and symbols are
 * named but never invoked or serialised; everything else is walked and redacted.
 */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;

  const kind = typeof value;

  if (kind === 'string') return redactString(value as string);
  if (kind === 'number' || kind === 'boolean') return value;
  if (kind === 'bigint') return `${(value as bigint).toString()}n`;
  if (kind === 'function' || kind === 'symbol') return `[${kind}]`;

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    // A stack can embed interpolated values, so it is redacted like any string.
    const code = 'code' in value ? (value as { code?: unknown }).code : undefined;
    return {
      name: value.name,
      message: redactString(value.message),
      ...(typeof code === 'string' ? { code } : {}),
      ...(value.stack !== undefined ? { stack: redactString(value.stack) } : {}),
    };
  }

  if (depth >= MAX_DEPTH) return '[depth limit]';

  // Cycle detection is path-based, not visit-based: the marker is removed on the
  // way back up, so an object legitimately referenced from two sibling fields
  // still serialises twice instead of the second one reading "[circular]".
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);
  const result = redactContainer(value, depth, seen);
  seen.delete(value as object);
  return result;
}

function redactContainer(value: object, depth: number, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1, seen));
    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `[+${value.length - MAX_ARRAY_ITEMS} more]`]
      : items;
  }

  if (value instanceof Map) {
    return redact(Object.fromEntries(value.entries()), depth, seen);
  }
  if (value instanceof Set) {
    return redact([...value.values()], depth, seen);
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(source[key], depth + 1, seen);
  }
  return output;
}

/** Convenience wrapper for the common case of a flat field bag. */
export function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const redacted = redact(fields);
  return typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}
