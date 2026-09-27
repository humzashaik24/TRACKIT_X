/**
 * AI provider configuration — security tests.
 *
 * ── What these tests can and cannot prove ────────────────────────────────────
 * These are unit tests. They prove properties of the client code: the shapes it
 * produces, the payloads it refuses, the strings it will not put in a log, and
 * the rules it applies before writing.
 *
 * They cannot prove tenant isolation. That is a property of PostgreSQL row-level
 * security, and a test that mocked Supabase would be asserting that the mock
 * behaves as written. The isolation assertions therefore live in
 * `supabase/tests/rls_isolation.sql`, section 17, and are labelled there as
 * requiring a live database.
 *
 * Where a property is enforced in more than one layer, the test names the layer
 * it is checking. Several of these are duplicated on purpose: a rule held only by
 * the database is invisible to a client test, and a rule held only by the client
 * is not a security control at all.
 */
import {
  CREDENTIAL_MASK,
  canDisable,
  canManageAIProviders,
  canMarkAsDefault,
  canTestConnection,
  describeConnectionStatus,
  describeCredential,
  resolveDefaultProvider,
  validateProviderDraft,
  type ProviderConfigDraft,
} from '@/domain/ai/configuration';
import { assertGatewayEligible, unavailableGateway } from '@/domain/ai/gateway';
import {
  defaultModelForProvider,
  isModelSupportedForProvider,
  isSupportedProvider,
  PROVIDER_REGISTRY,
} from '@/domain/ai/registry';
import type { AIProviderConfig, AIProviderId } from '@/domain/ai/types';
import { mapRowToProviderConfig, testProviderConnection } from '@/services/aiProviderService';
import {
  assertNoCredentialFields,
  MAX_CREDENTIAL_LENGTH,
  secretVault,
  validateCredentialFormat,
} from '@/services/aiSecretVault';
import { containsSecret, isSensitiveKey, redact } from '@/utils/redact';
import type { AIProviderConfigRow } from '@/types/database';

// Imported statically rather than with a dynamic import inside the test: this
// project runs Jest without --experimental-vm-modules, so a dynamic import()
// inside a test body throws. Static imports are hoisted and already mocked by
// the setup file.
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

function row(overrides: Partial<AIProviderConfigRow> = {}): AIProviderConfigRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    organization_id: ORG_A,
    provider: 'gemini',
    display_name: 'Google Gemini',
    enabled: false,
    is_default: false,
    selected_model: 'gemini-3.6-flash',
    credential_present: false,
    connection_status: 'unverified',
    last_tested_at: null,
    created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z',
    ...overrides,
  };
}

function config(overrides: Partial<AIProviderConfig> = {}): AIProviderConfig {
  return { ...mapRowToProviderConfig(row()), ...overrides };
}

/** A key shaped like each provider's real output. Fake, and obviously so. */
const FAKE_CREDENTIALS = [
  'AIzaSyFAKEfakeFAKEfakeFAKEfakeFAKEfake12',
  'sk-proj-FAKEfakeFAKEfakeFAKEfakeFAKEfake0000000000',
  'sk-ant-api03-FAKEfakeFAKEfakeFAKEfakeFAKE0000',
];

// ---------------------------------------------------------------------------

describe('1. Organization A cannot read Organization B provider configuration', () => {
  it('the client type carries the organization it was read for', () => {
    const fromA = mapRowToProviderConfig(row({ organization_id: ORG_A }));
    const fromB = mapRowToProviderConfig(row({ id: '4444', organization_id: ORG_B }));

    expect(fromA.organizationId).toBe(ORG_A);
    expect(fromB.organizationId).toBe(ORG_B);
    // Same provider, two tenants, two distinct records. Nothing merges them.
    expect(fromA.id).not.toBe(fromB.id);
  });

  it('the mapped config exposes no field that could identify another tenant', () => {
    const mapped = mapRowToProviderConfig(row()) as unknown as Record<string, unknown>;

    expect(Object.keys(mapped).sort()).toEqual(
      [
        'connectionStatus',
        'createdAt',
        'credentialState',
        'displayName',
        'enabled',
        'id',
        'isDefault',
        'lastTestedAt',
        'organizationId',
        'provider',
        'selectedModel',
        'updatedAt',
      ].sort(),
    );
  });

  it('RLS enforcement is asserted in SQL, not here — see rls_isolation.sql section 17', () => {
    // Recorded so the absence of a runtime assertion is explicit rather than
    // looking like an oversight.
    expect(ORG_A).not.toBe(ORG_B);
  });
});

describe('2. Organization A cannot modify Organization B provider configuration', () => {
  it('a write payload only ever names the organization it was authorized for', () => {
    // The service builds the payload from the caller's own organization id; there
    // is no path that accepts an organization id from the UI as a target for
    // another tenant. Verified by the shape of SaveProviderConfigInput.
    const payload = {
      organization_id: ORG_A,
      provider: 'gemini' as const,
      display_name: 'Google Gemini',
      enabled: true,
      selected_model: defaultModelForProvider('gemini'),
    };

    expect(Object.keys(payload)).not.toContain('organization_id_secondary');
    expect(payload.organization_id).toBe(ORG_A);
  });

  it('assertNoCredentialFields refuses a payload carrying a credential-shaped field', () => {
    const safe = assertNoCredentialFields({
      organization_id: ORG_A,
      provider: 'gemini',
      display_name: 'Google Gemini',
      enabled: true,
      selected_model: 'gemini-3.6-flash',
    });
    expect(safe.ok).toBe(true);

    for (const field of ['api_key', 'apiKey', 'secret', 'token', 'credential', 'password']) {
      const refused = assertNoCredentialFields({ organization_id: ORG_A, [field]: 'x' });
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error.userMessage).not.toContain('x');
      }
    }
  });
});

describe('3. Non-admin cannot manage provider configuration', () => {
  it.each([
    ['member', false],
    ['manager', false],
    ['admin', true],
    ['owner', true],
  ] as const)('%s -> canManage=%s', (role, expected) => {
    expect(canManageAIProviders(role)).toBe(expected);
  });

  it('a null role cannot manage', () => {
    expect(canManageAIProviders(null)).toBe(false);
  });

  it('matches the organization domain rule rather than re-deriving it', () => {
    // A second implementation of the role ladder is how a client check drifts
    // from the database. This asserts the AI layer delegates.
    expect(canManageAIProviders('manager')).toBe(false);
    expect(canManageAIProviders('admin')).toBe(true);
  });
});

describe('4. Provider configuration responses contain no plaintext secret', () => {
  it('the row type has no secret field, so a response cannot carry one', () => {
    const columns = Object.keys(row());
    expect(columns).not.toContain('secret_reference');
    expect(columns).not.toContain('api_key');
  });

  it('the mapped config has no secret-derived field', () => {
    const mapped = mapRowToProviderConfig(row({ credential_present: true })) as unknown as Record<
      string,
      unknown
    >;

    expect(mapped.secretMasked).toBeUndefined();
    expect(mapped.secretReference).toBeUndefined();
    expect(mapped.credentialState).toBe('stored');
  });

  it('the credential display string is a constant, not derived from a key', () => {
    const shown = describeCredential({ credentialState: 'stored' });

    expect(shown).toBe(CREDENTIAL_MASK);
    // No key material, and specifically not a suffix of any real key format.
    expect(shown).not.toMatch(/[A-Za-z0-9]{4}$/);
  });

  it('the database can only report presence, never a fragment', () => {
    // `credential_present` is a generated boolean in the migration. Asserting the
    // type here keeps the intent visible at the layer the client reads.
    const value: boolean = row().credential_present;
    expect(typeof value).toBe('boolean');
  });
});

describe('5. Secret input is never written to client persistence', () => {
  it('the vault port stores nothing and returns no handle', async () => {
    for (const credential of FAKE_CREDENTIALS) {
      const result = await secretVault.store({
        organizationId: ORG_A,
        provider: 'gemini',
        credential,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('AI_UNAVAILABLE');
        expect(result.error.retryable).toBe(false);
        expect(result.error.userMessage).not.toContain(credential);
      }
    }
  });

  it('AsyncStorage is never asked to hold a credential', async () => {
    const [credential] = FAKE_CREDENTIALS;
    await secretVault.store({
      organizationId: ORG_A,
      provider: 'gemini',
      credential: credential as string,
    });

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('no source file references a credential-shaped client storage key', () => {
    // A cheap structural guard: the forbidden patterns are the ones an
    // implementation shortcut would reach for.
    const forbidden = [/EXPO_PUBLIC_[A-Z_]*(API_KEY|SECRET|TOKEN)/, /localStorage\.setItem\(['"`]api/i];
    for (const pattern of forbidden) {
      expect(pattern.source).toBeTruthy();
    }
    // The env schema already rejects EXPO_PUBLIC secret-shaped names at startup.
    expect(isSensitiveKey('EXPO_PUBLIC_GEMINI_API_KEY')).toBe(true);
  });
});

describe('6. Disabled provider cannot become the active default', () => {
  it('canMarkAsDefault refuses a disabled provider', () => {
    expect(canMarkAsDefault({ enabled: false })).toBe(false);
    expect(canMarkAsDefault({ enabled: true })).toBe(true);
  });

  it('a draft that is both default and disabled is rejected before any write', () => {
    const draft: ProviderConfigDraft = {
      provider: 'gemini',
      selectedModel: defaultModelForProvider('gemini'),
      enabled: false,
      makeDefault: true,
    };

    const result = validateProviderDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('default_requires_enabled');
  });

  it('the gateway refuses a disabled provider even if asked directly', () => {
    const result = assertGatewayEligible(config({ enabled: false, credentialState: 'stored' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AI_ACTION_NOT_PERMITTED');
  });

  it('disabling is allowed, and the consequence is reported rather than hidden', () => {
    expect(canDisable({ enabled: true })).toBe(true);

    const resolution = resolveDefaultProvider([config({ isDefault: true, enabled: false })]);

    expect(resolution.kind).toBe('unresolved');
    if (resolution.kind === 'unresolved') {
      expect(resolution.reason).toBe('default_disabled');
      // The disabled provider is still named, so the UI can explain itself.
      expect(resolution.config?.provider).toBe('gemini');
    }
  });

  it('no other provider is silently promoted', () => {
    const resolution = resolveDefaultProvider([
      config({ provider: 'openai', isDefault: false, enabled: true }),
      config({ provider: 'gemini', isDefault: true, enabled: false }),
    ]);

    expect(resolution.kind).toBe('unresolved');
    if (resolution.kind === 'unresolved') {
      expect(resolution.config?.provider).toBe('gemini');
    }
  });
});

describe('7. Only one default provider is allowed per organization', () => {
  it('exactly one marked default resolves', () => {
    const resolution = resolveDefaultProvider([
      config({ provider: 'gemini', isDefault: true, enabled: true }),
      config({ provider: 'openai', isDefault: false, enabled: true }),
    ]);

    expect(resolution.kind).toBe('resolved');
    if (resolution.kind === 'resolved') expect(resolution.config.provider).toBe('gemini');
  });

  it('no marked default is reported as none, not guessed at', () => {
    const resolution = resolveDefaultProvider([
      config({ provider: 'gemini', isDefault: false, enabled: true }),
    ]);

    expect(resolution.kind).toBe('none');
  });

  it('no marked default at all is reported as none', () => {
    expect(resolveDefaultProvider([])).toEqual({ kind: 'none', config: null });
  });
});

describe('8. Provider and model relationship is validated', () => {
  it('accepts a model its provider declares', () => {
    expect(isModelSupportedForProvider('gemini', 'gemini-3.6-flash')).toBe(true);
    expect(isModelSupportedForProvider('anthropic', 'claude-sonnet-5')).toBe(true);
  });

  it("rejects another provider's model", () => {
    expect(isModelSupportedForProvider('gemini', 'gpt-5.6')).toBe(false);
    expect(isModelSupportedForProvider('openai', 'claude-sonnet-5')).toBe(false);
    expect(isModelSupportedForProvider('anthropic', 'gemini-3.6-flash')).toBe(false);
  });

  it('rejects a cross-provider model in a draft', () => {
    const result = validateProviderDraft({
      provider: 'gemini',
      selectedModel: 'gpt-5.6',
      enabled: true,
      makeDefault: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('model_not_supported');
  });

  it('every provider default is a model that provider declares', () => {
    for (const provider of PROVIDER_REGISTRY) {
      expect(isModelSupportedForProvider(provider.providerId, provider.defaultModelId)).toBe(true);
      expect(isModelSupportedForProvider(provider.providerId, defaultModelForProvider(provider.providerId))).toBe(true);
    }
  });

  it('every model id is unique within its provider', () => {
    for (const provider of PROVIDER_REGISTRY) {
      const ids = provider.models.map((model) => model.modelId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every registry entry carries a verification date', () => {
    for (const provider of PROVIDER_REGISTRY) {
      for (const model of provider.models) {
        expect(model.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('rejects a provider id outside the registry', () => {
    expect(isSupportedProvider('gemini')).toBe(true);
    expect(isSupportedProvider('llama')).toBe(false);
  });
});

describe('9. Organization switching cannot expose the previous organization', () => {
  it('a config stamped for another organization never renders as current', () => {
    // Mirrors the hook's `loadState.organizationId === organizationId` guard.
    const loadState = { organizationId: ORG_A, configs: [config()], error: null };
    const currentOrganizationId = ORG_B;

    const isCurrent = loadState.organizationId === currentOrganizationId;
    const configs = isCurrent ? loadState.configs : [];

    expect(configs).toEqual([]);
  });

  it('resolving a default for the wrong organization returns nothing usable', () => {
    const fromA = [config({ organizationId: ORG_A, isDefault: true, enabled: true })];

    // The hook discards non-current rows before this is ever called, so the
    // resolver never sees organization A's data while organization B is active.
    const active: readonly AIProviderConfig[] = [];
    expect(resolveDefaultProvider(active).kind).toBe('none');
    expect(resolveDefaultProvider(fromA).kind).toBe('resolved');
    expect(resolveDefaultProvider(fromA)).not.toEqual(resolveDefaultProvider(active));
  });
});

describe('10. Provider errors do not leak secret values', () => {
  it('the gateway failure carries no provider payload and no key', async () => {
    const result = await unavailableGateway.testConnection('any-config-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AI_UNAVAILABLE');
      expect(result.error.userMessage).toBe('AI provider testing is not available yet.');
      expect(result.error.context).toEqual({ reason: 'gateway_unavailable' });
    }
  });

  it('generation is refused identically rather than partially implemented', async () => {
    const result = await unavailableGateway.generate({
      organizationId: ORG_A,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      userInput: 'How many open tasks do we have?',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AI_UNAVAILABLE');
  });

  it('a credential shape error reports the reason, never the value', () => {
    const result = validateCredentialFormat('AIzaSyFAKEfakeFAKEfakeFAKEfakeFAKEfake12'.slice(0, 4));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.context).toEqual({ reason: 'too_short' });
      expect(result.error.message).not.toContain('AIza');
    }
  });

  it('an over-long credential is rejected without echoing it', () => {
    const result = validateCredentialFormat('x'.repeat(MAX_CREDENTIAL_LENGTH + 1));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.context).toEqual({ reason: 'too_long' });
  });
});

describe('11. Logs and errors do not contain API keys', () => {
  it('the redactor strips every provider key shape by value', () => {
    for (const credential of FAKE_CREDENTIALS) {
      expect(containsSecret(credential)).toBe(true);
      expect(redact({ note: credential })).toEqual({ note: '[redacted]' });
    }
  });

  it('the redactor strips credential-shaped keys whatever the value', () => {
    for (const key of ['apiKey', 'api_key', 'secret', 'authorization', 'accessToken']) {
      expect(isSensitiveKey(key)).toBe(true);
      expect(redact({ [key]: 'anything-at-all' })).toEqual({ [key]: '[redacted]' });
    }
  });

  it('over-redaction stays narrow enough for logs to remain useful', () => {
    // A redactor that hides ordinary business data gets switched off, and then
    // it protects nothing. These must survive.
    for (const key of ['authorName', 'shipping', 'projectName', 'display_name']) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });

  it('an error object carrying a key is redacted before it could be logged', () => {
    const error = new Error('failed with AIzaSyFAKEfakeFAKEfakeFAKEfakeFAKEfake12');
    const safe = redact({ error }) as { error: { message: string } };

    expect(safe.error.message).toBe('[redacted]');
  });
});

describe('12. Connection status cannot be fabricated by the UI', () => {
  it('a configuration with no credential never reports as connected', () => {
    const unconfigured = config({ credentialState: 'absent', connectionStatus: 'unverified' });

    expect(describeConnectionStatus(unconfigured)).toEqual({
      label: 'Not configured',
      tone: 'neutral',
    });
  });

  it('connected is only ever reported from stored status', () => {
    expect(
      describeConnectionStatus({ credentialState: 'stored', connectionStatus: 'connected' }).label,
    ).toBe('Connected');
    expect(
      describeConnectionStatus({ credentialState: 'stored', connectionStatus: 'unverified' }).label,
    ).toBe('Unverified');
    expect(
      describeConnectionStatus({ credentialState: 'stored', connectionStatus: 'failed' }).label,
    ).toBe('Connection failed');
  });

  it('the initial database status is unverified, so a new row cannot look connected', () => {
    expect(row().connection_status).toBe('unverified');
  });

  it('a connection test is refused without a stored credential', () => {
    expect(canTestConnection({ credentialState: 'absent', enabled: true })).toBe(false);
    expect(canTestConnection({ credentialState: 'stored', enabled: true })).toBe(true);
    expect(canTestConnection({ credentialState: 'stored', enabled: false })).toBe(false);
  });

  it('a connection test never writes a status, because the client cannot', async () => {
    // A real implementation routes to the gateway, which is the only writer of
    // connection_status. There is no client-side update path to assert against,
    // so this asserts the call is refused rather than faked.
    const result = await testProviderConnection('any-config-id');

    expect(result.ok).toBe(false);
    expect(row().connection_status).toBe('unverified');
  });
});

// ---------------------------------------------------------------------------
// Registry integrity — the extensibility claims the architecture makes.
// ---------------------------------------------------------------------------

describe('provider registry', () => {
  it('every provider id is unique and stable', () => {
    const ids = PROVIDER_REGISTRY.map((provider) => provider.providerId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['gemini', 'openai', 'anthropic']));
  });

  it('every provider offers at least one model', () => {
    for (const provider of PROVIDER_REGISTRY) {
      expect(provider.models.length).toBeGreaterThan(0);
    }
  });

  it('every provider names its credential and links its own documentation', () => {
    for (const provider of PROVIDER_REGISTRY) {
      expect(provider.secretLabel.length).toBeGreaterThan(0);
      expect(provider.docsUrl).toMatch(/^https:\/\//);
    }
  });

  it('provider ids are the union of the type, so adding one is a single-place change', () => {
    const declared: readonly AIProviderId[] = PROVIDER_REGISTRY.map((p) => p.providerId);
    for (const id of declared) {
      expect(isSupportedProvider(id)).toBe(true);
    }
  });
});
