/**
 * Trackit X — AI provider configuration state.
 *
 * Owns the load/mutate cycle for the Settings screen and the authorization
 * decision the screen renders from.
 *
 * ── Organization switching ───────────────────────────────────────────────────
 * Async results are stamped with the organization id they were requested for, and
 * anything stamped with a different id is discarded on read. This is the pattern
 * the other feature hooks use and it exists for a specific failure: a slow
 * response for organization A landing after the user has switched to organization
 * B would otherwise populate B's screen with A's provider configuration, and the
 * provider list is exactly the sort of data that should never cross a tenant
 * boundary in a render.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useOrganization } from '@/contexts/OrganizationContext';
import {
  canManageAIProviders,
  resolveDefaultProvider,
  type DefaultProviderResolution,
} from '@/domain/ai/configuration';
import type { AIProviderConfig, AIProviderId } from '@/domain/ai/types';
import {
  clearDefaultProvider,
  getAIGatewayStatus,
  listProviderConfigs,
  removeProviderConfig,
  saveProviderConfig,
  setDefaultProvider,
  submitProviderCredential,
  testProviderConnection,
  type AIGatewayStatus,
  type SaveProviderConfigInput,
} from '@/services/aiProviderService';
import { secretVault } from '@/services/aiSecretVault';
import type { AppError } from '@/utils/errors';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'useAIProviderConfigs' });

interface ConfigLoadState {
  readonly organizationId: string | null;
  readonly configs: readonly AIProviderConfig[];
  readonly error: AppError | null;
}

const UNLOADED: ConfigLoadState = { organizationId: null, configs: [], error: null };

export interface UseAIProviderConfigsResult {
  readonly configs: readonly AIProviderConfig[];
  readonly loading: boolean;
  /** Set while a mutation is in flight, so the screen can disable its controls. */
  readonly saving: boolean;
  readonly busyProvider: AIProviderId | null;
  readonly error: AppError | null;
  /**
   * The last READ error, kept separate from `error` so the screen can tell "the
   * list never loaded" (render an error state, show no provider cards) apart from
   * "the list is fine, a mutation just failed" (show the cards with a banner).
   * Null once a read for the current organization has succeeded.
   */
  readonly loadError: AppError | null;
  /** From the organization's own membership row. Drives every write control. */
  readonly canManage: boolean;
  readonly defaultResolution: DefaultProviderResolution;
  readonly gateway: AIGatewayStatus;
  readonly vaultAvailable: boolean;
  readonly refresh: () => Promise<void>;
  readonly save: (input: Omit<SaveProviderConfigInput, 'organizationId'>) => Promise<boolean>;
  readonly makeDefault: (provider: AIProviderId) => Promise<boolean>;
  readonly clearDefault: () => Promise<boolean>;
  readonly remove: (provider: AIProviderId) => Promise<boolean>;
  readonly test: (provider: AIProviderId) => Promise<boolean>;
  readonly submitCredential: (provider: AIProviderId, credential: string) => Promise<boolean>;
}

export function useAIProviderConfigs(): UseAIProviderConfigsResult {
  const { organization, role } = useOrganization();
  const organizationId = organization?.id ?? null;
  const canManage = canManageAIProviders(role);

  const [loadState, setLoadState] = useState<ConfigLoadState>(UNLOADED);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyProvider, setBusyProvider] = useState<AIProviderId | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const loadConfigs = useCallback(async (): Promise<void> => {
    if (organizationId === null) {
      setLoadState(UNLOADED);
      setFetching(false);
      return;
    }
    setFetching(true);
    const result = await listProviderConfigs(organizationId);
    setLoadState({
      organizationId,
      configs: result.ok ? result.value : [],
      error: result.ok ? null : result.error,
    });
    setFetching(false);
  }, [organizationId]);

  useEffect(() => {
    if (organizationId === null) return;
    // The fetch lives in an async IIFE so the state updates happen in a
    // continuation, never synchronously in the effect body. Calling the
    // setState-bearing callback directly here would cascade a render on every
    // organization change.
    let cancelled = false;

    void (async () => {
      setFetching(true);
      const result = await listProviderConfigs(organizationId);
      if (cancelled) return;
      setLoadState({
        organizationId,
        configs: result.ok ? result.value : [],
        error: result.ok ? null : result.error,
      });
      setFetching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Discard anything stamped for a different organization before it can render.
  // Memoised so the identity is stable across renders, which keeps the derived
  // values below from being rebuilt on every unrelated state change.
  const isCurrent = loadState.organizationId === organizationId;
  const configs = useMemo(
    () => (isCurrent ? loadState.configs : []),
    [isCurrent, loadState.configs],
  );
  const loading = organizationId !== null && (!isCurrent || fetching);
  const loadError = isCurrent ? loadState.error : null;
  const error = actionError ?? loadError;

  const defaultResolution = useMemo(() => resolveDefaultProvider(configs), [configs]);

  const gateway = useMemo(() => getAIGatewayStatus(), []);
  const vaultAvailable = secretVault.availability.available;

  /**
   * Shared guard and wrapper for every mutation.
   *
   * The client-side role check is a courtesy so a member gets a sentence rather
   * than a database error. It is not the control: RLS is. A member who skipped
   * this would have their write silently filtered, which `requireAffectedRows`
   * turns back into `PERMISSION_DENIED`.
   */
  const runMutation = useCallback(
    async (operation: string, action: () => Promise<boolean>): Promise<boolean> => {
      if (organizationId === null) return false;
      if (!canManage) {
        log.warn('Refused a client-side AI provider mutation', { operation });
        setActionError(
          appError('PERMISSION_DENIED', `Refused '${operation}' client-side: not an organization admin.`, {
            userMessage: 'Only an organization admin can change AI provider settings.',
            context: { operation },
          }),
        );
        return false;
      }
      setSaving(true);
      setActionError(null);
      try {
        const succeeded = await action();
        if (succeeded) await loadConfigs();
        return succeeded;
      } finally {
        setSaving(false);
      }
    },
    [canManage, loadConfigs, organizationId],
  );

  const save = useCallback(
    (input: Omit<SaveProviderConfigInput, 'organizationId'>): Promise<boolean> =>
      runMutation('save', async () => {
        const result = await saveProviderConfig({ ...input, organizationId: organizationId ?? '' });
        if (!result.ok) {
          setActionError(result.error);
          return false;
        }
        return true;
      }),
    [organizationId, runMutation],
  );

  const makeDefault = useCallback(
    (provider: AIProviderId): Promise<boolean> =>
      runMutation('set_default', async () => {
        const result = await setDefaultProvider(organizationId ?? '', provider);
        if (!result.ok) {
          setActionError(result.error);
          return false;
        }
        return true;
      }),
    [organizationId, runMutation],
  );

  const clearDefault = useCallback(
    (): Promise<boolean> =>
      runMutation('clear_default', async () => {
        const result = await clearDefaultProvider(organizationId ?? '');
        if (!result.ok) {
          setActionError(result.error);
          return false;
        }
        return true;
      }),
    [organizationId, runMutation],
  );

  const remove = useCallback(
    (provider: AIProviderId): Promise<boolean> =>
      runMutation('remove', async () => {
        setBusyProvider(provider);
        const result = await removeProviderConfig(organizationId ?? '', provider);
        setBusyProvider(null);
        if (!result.ok) {
          setActionError(result.error);
          return false;
        }
        return true;
      }),
    [organizationId, runMutation],
  );

  const test = useCallback(
    async (provider: AIProviderId): Promise<boolean> => {
      if (organizationId === null || !canManage) return false;
      const target = configs.find((config) => config.provider === provider);
      if (target === undefined) return false;

      setBusyProvider(provider);
      setActionError(null);
      try {
        const result = await testProviderConnection(target.id);
        if (!result.ok) {
          setActionError(result.error);
          return false;
        }
        await loadConfigs();
        return result.value.reachable;
      } finally {
        setBusyProvider(null);
      }
    },
    [canManage, configs, loadConfigs, organizationId],
  );

  const submitCredential = useCallback(
    async (provider: AIProviderId, credential: string): Promise<boolean> => {
      if (organizationId === null || !canManage) return false;

      // The gateway takes a `configId`, not an organization and a provider, so
      // the configuration is resolved here the same way `test` resolves it. The
      // hook's own signature still speaks in providers, so no screen changes.
      const target = configs.find((config) => config.provider === provider);
      if (target === undefined) {
        setActionError(
          appError('VALIDATION_FAILED', `No ${provider} configuration exists to store a key on.`, {
            userMessage: 'Add that AI provider before saving a key for it.',
            context: { provider },
          }),
        );
        return false;
      }

      setActionError(null);
      const result = await submitProviderCredential({
        configId: target.id,
        credential,
      });
      if (!result.ok) {
        setActionError(result.error);
        return false;
      }
      await loadConfigs();
      return true;
    },
    [canManage, configs, loadConfigs, organizationId],
  );

  return {
    configs,
    loading,
    saving,
    busyProvider,
    error,
    loadError,
    canManage,
    defaultResolution,
    gateway,
    vaultAvailable,
    refresh: loadConfigs,
    save,
    makeDefault,
    clearDefault,
    remove,
    test,
    submitCredential,
  };
}
