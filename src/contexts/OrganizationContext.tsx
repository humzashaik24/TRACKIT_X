/**
 * Trackit X — organization context.
 *
 * Answers "which business am I looking at, and what am I in it?" for the whole
 * app. Every future feature — projects, attendance, payroll, inventory — is
 * scoped by the organization this provider holds, so it is loaded once here
 * rather than re-fetched per screen.
 *
 * ── This is not an authorisation boundary ───────────────────────────────────
 * `role` is here so the UI can hide an action the user cannot take. It is NOT
 * what stops them taking it. Row Level Security evaluates the caller's real role
 * in Postgres on every request, including requests this provider knows nothing
 * about. If the two ever disagree, the database wins and the UI was wrong.
 *
 * ── Why memberships, plural ─────────────────────────────────────────────────
 * An accountant may belong to several businesses, and an owner may run two. The
 * shape is a list from the start, because retrofitting multi-tenancy onto a
 * single-organization assumption means touching every query.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OrganizationRole, OrganizationRow } from '@/types/database';
import * as organizations from '@/services/organizationService';
import { logger } from '@/utils/logger';
import { isOk, type ActionResult } from '@/utils/result';
import type { AppError } from '@/utils/errors';

import { useAuth } from './AuthContext';

const log = logger.child({ module: 'OrganizationContext' });

/**
 * Remembers the last organization chosen, so someone who works in two businesses
 * does not pick again on every launch. Only an id is stored — no names, no roles,
 * nothing that would be sensitive if the device were read.
 */
const ACTIVE_ORGANIZATION_KEY = 'trackitx.organization.active';

export type OrganizationStatus = 'loading' | 'ready' | 'error';

export interface OrganizationContextValue {
  readonly status: OrganizationStatus;
  /** Present only while `status === 'error'`. Render `error.userMessage`. */
  readonly error: AppError | null;
  readonly memberships: readonly organizations.Membership[];
  readonly organization: OrganizationRow | null;
  /** The caller's role in `organization`. `null` when there is no organization. */
  readonly role: OrganizationRole | null;
  /** Extra `module.action` grants layered on the role. */
  readonly permissions: readonly string[];
  /**
   * True when the user is signed in, loading has finished, and they belong to no
   * organization — the condition the router uses to route to onboarding.
   */
  readonly needsOnboarding: boolean;

  refresh(): Promise<void>;
  selectOrganization(organizationId: string): void;
  createOrganization(
    params: organizations.CreateOrganizationParams,
  ): Promise<ActionResult<OrganizationRow>>;
}

export const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export interface OrganizationProviderProps {
  children: ReactNode;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const { status: authStatus, user } = useAuth();

  const [status, setStatus] = useState<OrganizationStatus>('loading');
  const [error, setError] = useState<AppError | null>(null);
  const [memberships, setMemberships] = useState<readonly organizations.Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setError(null);

    const result = await organizations.listMemberships();
    if (!result.ok) {
      log.warn('Could not load memberships', { code: result.error.code });
      setError(result.error);
      setStatus('error');
      return;
    }

    setMemberships(result.value);

    // Restore the previous choice, but only if it is still a membership — a
    // stored id whose access was revoked must not become the active tenant.
    const stored = await AsyncStorage.getItem(ACTIVE_ORGANIZATION_KEY).catch(() => null);
    const storedIsValid =
      stored !== null && result.value.some((m) => m.organization.id === stored);

    setActiveId(storedIsValid ? stored : (result.value[0]?.organization.id ?? null));
    setStatus('ready');
  }, []);

  /**
   * Loading is keyed on the user id rather than on a boolean, so switching
   * accounts on one device reloads instead of showing the previous user's
   * businesses. The reset on sign-out is not cosmetic: leaving the list in place
   * would let a stale tenant id ride into the next session's queries.
   */
  useEffect(() => {
    if (authStatus === 'restoring') {
      setStatus('loading');
      return;
    }
    if (authStatus === 'signedOut') {
      setMemberships([]);
      setActiveId(null);
      setError(null);
      setStatus('ready');
      return;
    }
    void load();
  }, [authStatus, user?.id, load]);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      // Refuses an id the user has no membership for. A client-side guard only —
      // RLS would return nothing for such an id anyway — but it keeps the UI from
      // entering a state where every panel is empty for no visible reason.
      if (!memberships.some((m) => m.organization.id === organizationId)) {
        log.warn('Ignored a selection outside the user’s memberships');
        return;
      }
      setActiveId(organizationId);
      void AsyncStorage.setItem(ACTIVE_ORGANIZATION_KEY, organizationId).catch(() => {
        // Persistence is a convenience; the selection already applied in memory.
      });
    },
    [memberships],
  );

  const createOrganization = useCallback(
    async (params: organizations.CreateOrganizationParams) => {
      const result = await organizations.createOrganization(params);
      if (isOk(result)) {
        // Reload rather than push the new row onto the list: the membership row
        // was created by the same transaction, and reading it back is what
        // confirms the owner role actually landed instead of assuming it did.
        await load();
        setActiveId(result.value.id);
        void AsyncStorage.setItem(ACTIVE_ORGANIZATION_KEY, result.value.id).catch(() => {});
      }
      return result;
    },
    [load],
  );

  const activeMembership = useMemo(
    () => memberships.find((m) => m.organization.id === activeId) ?? null,
    [memberships, activeId],
  );

  const value = useMemo<OrganizationContextValue>(
    () => ({
      status,
      error,
      memberships,
      organization: activeMembership?.organization ?? null,
      role: activeMembership?.role ?? null,
      permissions: activeMembership?.permissions ?? [],
      needsOnboarding:
        authStatus === 'signedIn' && status === 'ready' && memberships.length === 0,
      refresh: load,
      selectOrganization,
      createOrganization,
    }),
    [
      status,
      error,
      memberships,
      activeMembership,
      authStatus,
      load,
      selectOrganization,
      createOrganization,
    ],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (context === null) {
    throw new Error('useOrganization must be used inside an <OrganizationProvider>.');
  }
  return context;
}
