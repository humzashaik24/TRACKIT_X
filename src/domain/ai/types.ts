/**
 * Trackit X — AI provider domain types.
 *
 * These are the shapes the Settings screen reasons over and the shapes the future
 * AI Gateway will be handed. Three rules hold everywhere in this file:
 *
 *   1. No type here can carry a plaintext credential. There is no field for one,
 *      so no adapter, hook or component can accidentally start accepting one.
 *   2. A provider is identified by a stable id, never by its display name, so
 *      renaming a provider in the registry cannot orphan stored configuration.
 *   3. `unknown` is used where a value is genuinely not known yet. A missing
 *      fact is modelled as missing rather than guessed, because a guessed model
 *      id fails at the provider and a guessed context window is quoted as truth.
 */

/**
 * Supported provider identifiers.
 *
 * Mirrors `public.ai_provider` in the database. Adding a provider is additive in
 * both places: a new enum value in the migration, a new entry in the registry.
 * Nothing else in the application needs to change, because every consumer reads
 * these ids from the registry rather than switching on them.
 */
export type AIProviderId = 'gemini' | 'openai' | 'anthropic';

/** What a model can be relied on for. Deliberately coarse and provider-agnostic. */
export type AIModelCapability =
  | 'text'
  | 'reasoning'
  | 'code'
  | 'long_context'
  | 'structured_output';

export interface AIModelDefinition {
  /** The exact identifier sent to the provider. Never a display label. */
  readonly modelId: string;
  readonly displayName: string;
  /** One line on when to pick this model. */
  readonly summary: string;
  /**
   * Context window in tokens, or `null` when the provider does not publish one we
   * are willing to stand behind. `null` is displayed as "not published" rather
   * than as a number that would be wrong.
   */
  readonly contextWindowTokens: number | null;
  readonly capabilities: readonly AIModelCapability[];
  /**
   * ISO date (YYYY-MM-DD) this entry was last checked against the provider's own
   * documentation. Model lineups move; an entry with no date is a claim we cannot
   * defend, so the type makes the date impossible to omit.
   */
  readonly verifiedOn: string;
}

export interface AIProviderDefinition {
  readonly providerId: AIProviderId;
  readonly displayName: string;
  readonly summary: string;
  /** Where the credential is created, for an administrator who needs one. */
  readonly docsUrl: string;
  /** What the credential is called at the provider, e.g. "API key". */
  readonly secretLabel: string;
  /** Applied when an administrator configures this provider without choosing. */
  readonly defaultModelId: string;
  readonly models: readonly AIModelDefinition[];
}

/**
 * Connection state of a stored configuration.
 *
 * `unverified` is the only state a client can ever produce, because
 * `connection_status` is not a column the client role may write. A provider
 * becomes `connected` only when the server-side AI Gateway has actually reached
 * the provider with the stored credential.
 */
export type AIConnectionStatus = 'unverified' | 'connected' | 'failed';

/**
 * Whether a credential is held in the server-side vault.
 *
 * Derived in the database from the opaque `secret_reference`, which the client
 * role cannot select. The client therefore learns *that* a credential exists,
 * never anything derived from its value — not its length, not a suffix, not a
 * hash.
 */
export type AICredentialState = 'absent' | 'stored';

/**
 * Safe configuration metadata for one provider in one organization.
 *
 * This is the only provider shape the client ever holds. It is assembled by the
 * service from a column list that excludes the secret reference, and it has no
 * field capable of holding a secret.
 */
export interface AIProviderConfig {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: AIProviderId;
  readonly displayName: string;
  readonly enabled: boolean;
  /** Marked default in storage. May point at a disabled provider — see configuration.ts. */
  readonly isDefault: boolean;
  readonly selectedModel: string;
  readonly credentialState: AICredentialState;
  readonly connectionStatus: AIConnectionStatus;
  readonly lastTestedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Gateway request contract. Carries business context, never credentials. */
export interface AIRequest {
  readonly organizationId: string;
  readonly provider: AIProviderId;
  readonly model: string;
  readonly systemInstructions?: string;
  readonly userInput: string;
  /**
   * Structured business context for the organization — dashboard metrics,
   * workload, project and task rollups. Serialised by the caller; never a raw
   * database row, so personal data and any future secret-bearing column cannot
   * ride along by accident.
   */
  readonly businessContext?: Readonly<Record<string, unknown>>;
  readonly toolContext?: Readonly<Record<string, unknown>>;
}

export interface AIUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface AIResponse {
  readonly provider: AIProviderId;
  readonly model: string;
  readonly output: string;
  readonly usage?: AIUsage;
  /** Opaque id from the gateway log. Used for support, never shown as content. */
  readonly requestId: string;
  readonly latencyMs?: number;
}
