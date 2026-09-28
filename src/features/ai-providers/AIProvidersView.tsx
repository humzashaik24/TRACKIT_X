/**
 * Trackit X — AI Providers settings.
 *
 * Lets an organization administrator point the future Copilot at a provider,
 * choose which of that provider's models answers, and switch it on or off.
 *
 * ── What this screen will not do ─────────────────────────────────────────────
 * It will not display a connection state it has not been told, it will not
 * derive anything from a credential, and it will not offer a Test Connection
 * button that quietly does nothing.
 *
 * That last one is the uncomfortable one. A "Test Connection" affordance is
 * expected, so the button is here and it is enabled — but pressing it returns a
 * specific, accurate failure from the gateway port, and the stored status is left
 * untouched. The alternative, greying the button out and hiding the requirement,
 * would leave an administrator with no way to learn why. The screen states what is
 * missing instead of pretending the feature is finished.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 * Everything here reads from theme tokens. There is no literal colour in this
 * file, which is what lets the same screen render correctly in the light theme
 * that `more.tsx` already offers a switch for.
 */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  createStyles,
  Divider,
  ErrorState,
  HStack,
  Icon,
  Input,
  LoadingState,
  Modal,
  Select,
  Spacer,
  Text,
  useStyles,
  useToast,
  VStack,
  type BadgeIntent,
  type SelectOption,
} from '@/design-system';
import {
  canTestConnection,
  CREDENTIAL_MASK,
  describeConnectionStatus,
  type ConnectionStatusPresentation,
} from '@/domain/ai/configuration';
import { getProviderDefinition, PROVIDER_REGISTRY } from '@/domain/ai/registry';
import type { AIProviderConfig, AIProviderId } from '@/domain/ai/types';
import { validateCredentialFormat } from '@/services/aiSecretVault';
import { useAIProviderConfigs } from './useAIProviderConfigs';

const styles = createStyles((theme) => ({
  hero: {
    gap: theme.space[2],
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    flexWrap: 'wrap',
  },
  notice: {
    gap: theme.space[1.5],
  },
  noticeRow: {
    flexDirection: 'row',
    gap: theme.space[2],
    alignItems: 'flex-start',
  },
  noticeIcon: {
    marginTop: 2,
  },
  noticeText: {
    flex: 1,
    gap: theme.space[1.5],
  },
  providerCard: {
    gap: theme.space[3],
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.space[2],
  },
  providerHeaderText: {
    flex: 1,
    gap: theme.space[0.5],
  },
  badgeRow: {
    flexDirection: 'row',
    gap: theme.space[1.5],
    flexWrap: 'wrap',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space[3],
    paddingVertical: theme.space[1.5],
  },
  detailLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1.5],
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: theme.space[2],
    flexWrap: 'wrap',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space[3],
    paddingVertical: theme.space[1],
  },
  toggleText: {
    flex: 1,
    gap: theme.space[0.5],
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1.5],
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  toggleEnabled: {
    backgroundColor: theme.colors.success.subtle,
    borderColor: theme.colors.success.border,
  },
  toggleDisabled: {
    backgroundColor: theme.colors.surfaceInset,
    borderColor: theme.colors.border,
  },
  registryNote: {
    gap: theme.space[1.5],
  },
  modelSummary: {
    gap: theme.space[0.5],
  },
  footer: {
    gap: theme.space[2],
  },
}));

/** Maps the status tone onto the badge intents that exist in the design system. */
const TONE_TO_INTENT: Record<ConnectionStatusPresentation['tone'], BadgeIntent> = {
  neutral: 'neutral',
  success: 'success',
  danger: 'danger',
};

export function AIProvidersView() {
  const {
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
    refresh,
    save,
    makeDefault,
    clearDefault,
    remove,
    test,
    submitCredential,
  } = useAIProviderConfigs();
  const s = useStyles(styles);
  const toast = useToast();

  const [editing, setEditing] = useState<AIProviderId | null>(null);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftDefault, setDraftDefault] = useState(false);
  const [credential, setCredential] = useState('');
  const [credentialError, setCredentialError] = useState<string | undefined>(undefined);
  // Covers the WHOLE save: configuration write AND the credential submit. `saving`
  // from the hook only spans the write, so without this the Save button stays
  // clickable between the two — the double-submit window.
  const [submitting, setSubmitting] = useState(false);

  const openEditor = useCallback(
    (provider: AIProviderId, config: AIProviderConfig | undefined) => {
      const definition = getProviderDefinition(provider);
      if (definition === undefined) return;
      setEditing(provider);
      setDraftModel(config?.selectedModel ?? definition.defaultModelId);
      setDraftEnabled(config?.enabled ?? false);
      setDraftDefault(config?.isDefault ?? false);
      setCredential('');
      setCredentialError(undefined);
    },
    [],
  );

  /** Clears the credential from component state on every exit path. */
  const closeEditor = useCallback(() => {
    setEditing(null);
    setDraftModel(null);
    setDraftEnabled(false);
    setDraftDefault(false);
    setCredential('');
    setCredentialError(undefined);
  }, []);

  const handleSave = useCallback(async () => {
    if (editing === null || submitting) return;

    if (credential.trim().length > 0) {
      const format = validateCredentialFormat(credential);
      if (!format.ok) {
        setCredentialError(format.error.userMessage);
        return;
      }
    }

    setSubmitting(true);
    try {
      const saved = await save({
        provider: editing,
        selectedModel: draftModel ?? undefined,
        enabled: draftEnabled,
        makeDefault: draftDefault,
      });
      if (!saved) return;

      if (credential.trim().length > 0) {
        const stored = await submitCredential(editing, credential);
        if (!stored) {
          // The configuration change is already committed, so the sheet stays open
          // with the credential intact and the reason visible. Discarding the key
          // here would leave the administrator retyping it with no better outcome.
          toast.show({
            title: 'Provider saved',
            message: 'The API key could not be stored. See the note on the screen.',
            intent: 'warning',
          });
          return;
        }
      }

      toast.show({ title: 'Provider updated', intent: 'success' });
      closeEditor();
    } finally {
      setSubmitting(false);
    }
  }, [closeEditor, credential, draftDefault, draftEnabled, draftModel, editing, save, submitCredential, submitting, toast]);

  const handleTest = useCallback(
    async (config: AIProviderConfig) => {
      const reachable = await test(config.provider);
      toast.show({
        title: reachable ? 'Connection verified' : 'Connection test failed',
        message: reachable
          ? `${config.displayName} responded.`
          : 'No AI Gateway is deployed, so no provider could be contacted.',
        intent: reachable ? 'success' : 'danger',
      });
    },
    [test, toast],
  );

  const handleRemove = useCallback(
    async (config: AIProviderConfig) => {
      const removed = await remove(config.provider);
      if (removed) {
        toast.show({ title: `${config.displayName} removed`, intent: 'success' });
      }
    },
    [remove, toast],
  );

  const handleMakeDefault = useCallback(
    async (config: AIProviderConfig) => {
      const changed = await makeDefault(config.provider);
      if (changed) {
        toast.show({ title: `${config.displayName} is now the default`, intent: 'success' });
      }
    },
    [makeDefault, toast],
  );

  const handleClearDefault = useCallback(async () => {
    const cleared = await clearDefault();
    if (cleared) {
      toast.show({ title: 'Default provider cleared', intent: 'success' });
    }
  }, [clearDefault, toast]);

  const editingDefinition = editing === null ? undefined : getProviderDefinition(editing);
  const editingConfig = configs.find((config) => config.provider === editing) ?? undefined;

  const modelOptions = useMemo<readonly SelectOption<string>[]>(() => {
    if (editingDefinition === undefined) return [];
    return editingDefinition.models.map((model) => ({
      value: model.modelId,
      label: model.displayName,
      description:
        model.contextWindowTokens === null
          ? model.summary
          : `${model.summary} ${model.contextWindowTokens.toLocaleString()} token context.`,
    }));
  }, [editingDefinition]);

  /**
   * Whether the registry cards below may state anything about a provider.
   *
   * The cards claim "Not configured" / "Disabled" from the config list. That claim is
   * only true once a read for THIS organization has actually landed: during the first
   * load the list is absent, and after a failed read it is unknown. Both would render
   * a false "not configured" — so the registry is hidden for those two states and the
   * screen says loading/failed instead. A `fetching` reload over cards that already
   * hold data keeps the cards (they are real data, not a guess).
   */
  const cardsKnown = loadError === null && (!loading || configs.length > 0);

  return (
    <VStack gap={5}>
      <VStack gap={2} style={s.hero}>
        <HStack gap={2} style={s.heroBadgeRow}>
          <Badge label="AI Providers" intent="ai" variant="soft" size="sm" icon="aiSpark" />
          {!gateway.available ? <Badge label="Gateway not deployed" intent="warning" variant="outline" size="sm" /> : null}
        </HStack>
        <Text variant="h3">AI Providers</Text>
        <Text tone="secondary">
          Choose which AI answers questions in the Trackit X Copilot. Providers are configured per
          organization, and each one keeps its own models.
        </Text>
      </VStack>

      {!gateway.available ? (
        <Card variant="glass" intent="warning" padding={4} style={s.notice}>
          <View style={s.noticeRow}>
            <Icon name="lock" size="sm" tone="warning" style={s.noticeIcon} />
            <VStack gap={1.5} style={s.noticeText}>
              <Text variant="body" weight="semibold">
                Credentials cannot be stored yet
              </Text>
              <Text tone="secondary">{gateway.reason}</Text>
              <Text tone="tertiary">
                Everything below — choosing a provider, picking a model, setting a default, switching
                one on or off — is stored now and enforced by the database. Only the credential and the
                connection test are waiting on the server.
              </Text>
            </VStack>
          </View>
        </Card>
      ) : null}

      {error !== null ? (
        <ErrorState
          inline
          title="AI provider settings"
          message={error.userMessage}
          onRetry={() => void refresh()}
        />
      ) : null}

      {!canManage ? (
        <Card variant="outline" padding={4} style={s.notice}>
          <View style={s.noticeRow}>
            <Icon name="shield" size="sm" tone="secondary" style={s.noticeIcon} />
            <VStack gap={1.5} style={s.noticeText}>
              <Text variant="body" weight="semibold">
                Read only
              </Text>
              <Text tone="secondary">
                You can see which AI providers this organization uses. Changing them is restricted to
                organization admins, and the database refuses the change regardless of what this
                screen offers.
              </Text>
            </VStack>
          </View>
        </Card>
      ) : null}

      {defaultResolution.kind === 'unresolved' && defaultResolution.reason === 'default_disabled' ? (
        <Card variant="outline" intent="warning" padding={4} style={s.notice}>
          <View style={s.noticeRow}>
            <Icon name="warning" size="sm" tone="warning" style={s.noticeIcon} />
            <VStack gap={1.5} style={s.noticeText}>
              <Text variant="body" weight="semibold">
                The default provider is switched off
              </Text>
              <Text tone="secondary">
                No other provider has been promoted in its place, because doing that would change
                which model answers without being asked. Choose a default below, or clear it.
              </Text>
              <HStack gap={2} style={s.actions}>
                <Button
                  label="Clear default"
                  variant="outline"
                  size="sm"
                  onPress={() => void handleClearDefault()}
                  disabled={!canManage || saving}
                />
              </HStack>
            </VStack>
          </View>
        </Card>
      ) : null}

      {loading && !cardsKnown ? (
        <Card variant="glass" padding={4}>
          <LoadingState variant="spinner" label="Loading provider configuration" />
        </Card>
      ) : null}

      {cardsKnown ? (
        <>
      {PROVIDER_REGISTRY.map((definition) => {
        const config = configs.find((entry) => entry.provider === definition.providerId);
        const status = config === undefined ? null : describeConnectionStatus(config);
        const isDefault = config?.isDefault ?? false;
        const canTest = config !== undefined && canTestConnection(config);
        const isBusy = busyProvider === definition.providerId;

        return (
          <Card
            key={definition.providerId}
            variant="glass"
            intent={isDefault ? 'accent' : 'neutral'}
            padding={4}
            accentEdge={isDefault}
            style={s.providerCard}
          >
            <View style={s.providerHeader}>
              <VStack gap={1} style={s.providerHeaderText}>
                <Text variant="h4">{definition.displayName}</Text>
                <Text tone="tertiary">{definition.summary}</Text>
              </VStack>
              <Icon name="ai" size="lg" tone={isDefault ? 'accent' : 'secondary'} />
            </View>

            <View style={s.badgeRow}>
              {status !== null ? (
                <Badge
                  label={status.label}
                  intent={TONE_TO_INTENT[status.tone]}
                  variant="soft"
                  size="sm"
                />
              ) : (
                <Badge label="Not configured" intent="neutral" variant="outline" size="sm" />
              )}
              {isDefault ? <Badge label="Default" intent="accent" variant="solid" size="sm" /> : null}
              {config?.enabled === true && isDefault === false ? (
                <Badge label="Enabled" intent="success" variant="outline" size="sm" />
              ) : null}
            </View>

            <Divider />

            <View style={s.detailRow}>
              <HStack gap={2} style={s.detailLabel}>
                <Icon name="aiBrain" size="sm" tone="tertiary" />
                <Text tone="secondary">Model</Text>
              </HStack>
              <Text variant="body" weight="medium" style={s.detailValue}>
                {config?.selectedModel ?? definition.defaultModelId}
              </Text>
            </View>

            <View style={s.detailRow}>
              <HStack gap={2} style={s.detailLabel}>
                <Icon name="key" size="sm" tone="tertiary" />
                <Text tone="secondary">API key</Text>
              </HStack>
              <Text variant="body" tone="secondary" style={s.detailValue}>
                {config === undefined || config.credentialState === 'absent'
                  ? 'Not configured'
                  : CREDENTIAL_MASK}
              </Text>
            </View>

            <View style={s.detailRow}>
              <HStack gap={2} style={s.detailLabel}>
                <Icon name="live" size="sm" tone="tertiary" />
                <Text tone="secondary">Availability</Text>
              </HStack>
              <Text variant="body" tone="secondary" style={s.detailValue}>
                {config?.enabled === true ? 'Enabled for the Copilot' : 'Disabled'}
              </Text>
            </View>

            {config?.lastTestedAt != null ? (
              <View style={s.detailRow}>
                <HStack gap={2} style={s.detailLabel}>
                  <Icon name="time" size="sm" tone="tertiary" />
                  <Text tone="secondary">Last tested</Text>
                </HStack>
                <Text variant="body" tone="secondary" style={s.detailValue}>
                  {new Date(config.lastTestedAt).toLocaleString()}
                </Text>
              </View>
            ) : null}

            <HStack gap={2} style={s.actions}>
              <Button
                label="Test Connection"
                variant="secondary"
                intent="ai"
                size="sm"
                iconLeft="live"
                disabled={!canManage || saving || !canTest}
                loading={isBusy}
                onPress={() => config !== undefined && void handleTest(config)}
              />
              {isDefault ? (
                <Button
                  label="Clear Default"
                  variant="ghost"
                  size="sm"
                  disabled={!canManage || saving}
                  onPress={() => void handleClearDefault()}
                />
              ) : (
                <Button
                  label="Set Default"
                  variant="ghost"
                  size="sm"
                  disabled={!canManage || saving || config?.enabled !== true}
                  onPress={() => config !== undefined && void handleMakeDefault(config)}
                />
              )}
              <Spacer />
              <Button
                label={config === undefined ? 'Configure' : 'Edit'}
                variant="primary"
                size="sm"
                iconLeft={config === undefined ? 'add' : 'edit'}
                disabled={!canManage || saving}
                onPress={() => openEditor(definition.providerId, config)}
              />
            </HStack>

            {config !== undefined ? (
              <Button
                label="Remove provider"
                variant="link"
                intent="danger"
                size="xs"
                iconLeft="delete"
                disabled={!canManage || saving}
                onPress={() => void handleRemove(config)}
              />
            ) : null}

            {config !== undefined && !canTest ? (
              <Text tone="tertiary">
                {config.credentialState === 'absent'
                  ? 'A connection test needs a stored API key, and none can be stored until the secure server vault is deployed.'
                  : 'This provider is switched off, so it is not tested.'}
              </Text>
            ) : null}
          </Card>
        );
      })}

      <Card variant="outline" padding={4} style={s.registryNote}>
        <HStack gap={2}>
          <Icon name="info" size="sm" tone="secondary" />
          <Text variant="body" weight="semibold">
            Where these models come from
          </Text>
        </HStack>
        <Text tone="secondary">
          Trackit X keeps a controlled list rather than asking each provider what it supports, because
          discovering models at runtime would require shipping a provider credential to the browser.
          Each entry records the date it was last checked against the provider&apos;s own
          documentation, and a context window is shown only where the provider publishes one.
        </Text>
      </Card>
        </>
      ) : null}

      <Modal
        visible={editing !== null}
        onClose={closeEditor}
        title={editingDefinition?.displayName ?? 'Configure provider'}
        description="Model, availability and default. The API key is sent to the server vault and never returned."
        size="md"
        intent="ai"
        icon="aiSpark"
        footer={
          <HStack gap={2} style={s.footer}>
            <Button label="Cancel" variant="ghost" onPress={closeEditor} />
            <Button
              label="Save provider"
              variant="primary"
              onPress={() => void handleSave()}
              loading={saving || submitting}
              disabled={submitting}
            />
          </HStack>
        }
      >
        <VStack gap={4}>
          <Select
            label="Model"
            options={modelOptions}
            value={draftModel}
            onChange={setDraftModel}
            helperText="Only models this provider publishes are offered."
            disabled={!canManage}
          />

          <View style={s.toggleRow}>
            <VStack gap={0.5} style={s.toggleText}>
              <Text variant="body" weight="medium">
                Enabled
              </Text>
              <Text tone="tertiary">
                A disabled provider is never selected by the Copilot, and cannot be the default.
              </Text>
            </VStack>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: draftEnabled, disabled: !canManage }}
              accessibilityLabel={`${editingDefinition?.displayName ?? 'Provider'} enabled`}
              disabled={!canManage}
              onPress={() => {
                setDraftEnabled((value) => !value);
                if (draftEnabled) setDraftDefault(false);
              }}
              style={[
                s.toggle,
                draftEnabled ? s.toggleEnabled : s.toggleDisabled,
              ]}
            >
              <Icon
                name={draftEnabled ? 'check' : 'close'}
                size="sm"
                tone={draftEnabled ? 'success' : 'tertiary'}
              />
              <Text variant="caption" weight="semibold" tone={draftEnabled ? 'success' : 'tertiary'}>
                {draftEnabled ? 'ON' : 'OFF'}
              </Text>
            </Pressable>
          </View>

          <View style={s.toggleRow}>
            <VStack gap={0.5} style={s.toggleText}>
              <Text variant="body" weight="medium">
                Default provider
              </Text>
              <Text tone="tertiary">
                One provider answers by default. Only one, and only while it is enabled.
              </Text>
            </VStack>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: draftDefault, disabled: !draftEnabled || !canManage }}
              accessibilityLabel={`${editingDefinition?.displayName ?? 'Provider'} is the default`}
              disabled={!canManage || !draftEnabled}
              onPress={() => setDraftDefault((value) => !value)}
              style={[
                s.toggle,
                draftDefault ? s.toggleEnabled : s.toggleDisabled,
              ]}
            >
              <Icon
                name={draftDefault ? 'check' : 'close'}
                size="sm"
                tone={draftDefault ? 'success' : 'tertiary'}
              />
              <Text variant="caption" weight="semibold" tone={draftDefault ? 'success' : 'tertiary'}>
                {draftDefault ? 'ON' : 'OFF'}
              </Text>
            </Pressable>
          </View>

          <Divider />

          <VStack gap={2}>
            <Input
              label={editingDefinition?.secretLabel ?? 'API key'}
              value={credential}
              onChangeText={(next) => {
                setCredential(next);
                setCredentialError(undefined);
              }}
              secureTextEntry
              editable={vaultAvailable && canManage}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="password"
              error={credentialError}
              helperText={
                editingConfig?.credentialState === 'stored'
                  ? `A key is already stored (${CREDENTIAL_MASK}). Leave this blank to keep it.`
                  : 'Sent straight to the server vault. Never saved to this device, logged, or sent back.'
              }
              placeholder={vaultAvailable ? 'Paste the provider key' : 'Unavailable until the server vault is deployed'}
            />
            {!vaultAvailable ? (
              <Text tone="warning">
                No secure server vault is deployed, so this key cannot be stored. Saving the rest of
                this form still works.
              </Text>
            ) : null}
          </VStack>
        </VStack>
      </Modal>
    </VStack>
  );
}
