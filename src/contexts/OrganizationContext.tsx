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

/**
 * One membership read, stamped with the user it belongs to.
 *
 * The stamp is the load-bearing part. Everything the provider exposes is derived
 * during render from `userId === user.id`, so a previous account's memberships can
 * never be read as the current account's — not even for the one render between a
 * sign-in and the effect that would have cleared them. Clearing state in an effect
 * would leave exactly that window open, and a stale tenant id riding into the next
 * session's queries is the single worst bug this file could have.
 */
interface LoadedMemberships {
  readonly userId: string;
  readonly memberships: readonly organizations.Membership[];
  /** Non-null when the read failed. `memberships` is then empty and meaningless. */
  readonly error: AppError | null;
  readonly activeId: string | null;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const { status: authStatus, user } = useAuth();
  const userId = user?.id ?? null;

  const [loaded, setLoaded] = useState<LoadedMemberships | null>(null);

  /**
   * Reads the membership list and returns what should be committed.
   *
   * It sets nothing. That separation is deliberate: the caller decides whether the
   * answer is still wanted, which is what makes the effect below safe to cancel, and
   * it keeps the "what did the database say" logic testable without a renderer.
   *
   * `preferredId` exists for the create-organization path, which knows which
   * organization should become active before the list has been re-read.
   */
  const read = useCallback(
    async (preferredId?: string): Promise<LoadedMemberships | null> => {
      if (userId === null) return null;

      const result = await organizations.listMemberships();
      if (!result.ok) {
        log.warn('Could not load memberships', { code: result.error.code });
        return { userId, memberships: [], error: result.error, activeId: null };
      }

      const isMember = (id: string): boolean =>
        result.value.some((m) => m.organization.id === id);

      // Restore the previous choice, but only if it is still a membership — a stored
      // id whose access was revoked must not become the active tenant.
      const stored = await AsyncStorage.getItem(ACTIVE_ORGANIZATION_KEY).catch(() => null);
      const activeId =
        preferredId !== undefined && isMember(preferredId)
          ? preferredId
          : stored !== null && isMember(stored)
            ? stored
            : (result.value[0]?.organization.id ?? null);

      return { userId, memberships: result.value, error: null, activeId };
    },
    [userId],
  );

  /**
   * Keyed on the user id (through `read`) rather than on a boolean, so switching
   * accounts on one device reloads instead of showing the previous user's businesses.
   *
   * Two things about the shape. There is no branch for `restoring` or `signedOut`:
   * both are answered by derivation below, which is safer than clearing state in an
   * effect, because an effect runs after the render that could still have shown it.
   * And the commit happens in the promise callback rather than by awaiting a function
   * that sets state — the database is an external system answering asynchronously,
   * and that is the one setState-from-an-effect shape that does not cascade a render.
   */
  useEffect(() => {
    if (authStatus !== 'signedIn') return;

    let cancelled = false;
    void read().then((next) => {
      if (cancelled || next === null) return;
      setLoaded(next);
    });

    return () => {
      cancelled = true;
    };
  }, [authStatus, read]);

  // ── Everything below is derived, not stored ────────────────────────────────
  // A committed read counts only for the user it was read for.
  const fresh = loaded !== null && loaded.userId === userId ? loaded : null;

  const status: OrganizationStatus =
    authStatus === 'restoring'
      ? 'loading'
      : // Signed out is a complete answer, not a pending one: there are no
        // memberships to load, and reporting `loading` would stall the route gate.
        authStatus === 'signedOut'
        ? 'ready'
        : fresh === null
          ? 'loading'
          : fresh.error !== null
            ? 'error'
            : 'ready';

  // Memoised because the signed-out branch is a fresh `[]` on every render, and this
  // value goes into the context object every consumer depends on.
  const memberships = useMemo(
    () => (authStatus === 'signedIn' ? (fresh?.memberships ?? []) : []),
    [authStatus, fresh],
  );
  const error = status === 'error' ? (fresh?.error ?? null) : null;
  const activeId = authStatus === 'signedIn' ? (fresh?.activeId ?? null) : null;

  const selectOrganization = useCallback((organizationId: string) => {
    setLoaded((previous) => {
      if (previous === null) return previous;
      // Refuses an id the user has no membership for. A client-side guard only —
      // RLS would return nothing for such an id anyway — but it keeps the UI from
      // entering a state where every panel is empty for no visible reason.
      if (!previous.memberships.some((m) => m.organization.id === organizationId)) {
        log.warn('Ignored a selection outside the user’s memberships');
        return previous;
      }
      void AsyncStorage.setItem(ACTIVE_ORGANIZATION_KEY, organizationId).catch(() => {
        // Persistence is a convenience; the selection already applied in memory.
      });
      return { ...previous, activeId: organizationId };
    });
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await read();
    if (next !== null) setLoaded(next);
  }, [read]);

  const createOrganization = useCallback(
    async (params: organizations.CreateOrganizationParams) => {
      const result = await organizations.createOrganization(params);
      if (isOk(result)) {
        // Re-read rather than push the new row onto the list: the membership row was
        // created by the same transaction, and reading it back is what confirms the
        // owner role actually landed instead of assuming it did.
        const next = await read(result.value.id);
        if (next !== null) setLoaded(next);
        void AsyncStorage.setItem(ACTIVE_ORGANIZATION_KEY, result.value.id).catch(() => {});
      }
      return result;
    },
    [read],
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
      refresh,
      selectOrganization,
      createOrganization,
    }),
    [
      status,
      error,
      memberships,
      activeMembership,
      authStatus,
      refresh,
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
