/**
 * Trackit X — authentication context.
 *
 * Holds the one piece of state the whole app branches on: is there a session,
 * and have we finished finding out? Screens read it; only this provider writes
 * it.
 *
 * ── Why a context rather than a hook per screen ─────────────────────────────
 * Session restoration is asynchronous and must happen exactly once. Six screens
 * each calling `getSession()` would produce six restores, six loading flickers,
 * and six chances to disagree about whether the user is signed in. One provider
 * at the router root removes that class of bug.
 *
 * ── The three states are not two ────────────────────────────────────────────
 * `restoring` is distinct from `signedOut` on purpose. Treating "we do not know
 * yet" as "signed out" is what makes an app flash its sign-in screen for a moment
 * on every cold start before dropping the user back where they were. The router
 * waits for `restoring` to end instead of guessing.
 */
import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import * as auth from '@/services/authService';
import { logger } from '@/utils/logger';
import type { ActionResult } from '@/utils/result';

const log = logger.child({ module: 'AuthContext' });

/** `restoring` → we are reading stored credentials and do not know yet. */
export type AuthStatus = 'restoring' | 'signedIn' | 'signedOut';

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly session: Session | null;
  readonly user: User | null;
  /** Convenience for the common branch. False while `restoring`. */
  readonly isSignedIn: boolean;
  /**
   * True when the account exists but the email has not been confirmed. Such a
   * user has no session, so this is carried separately to let the sign-in screen
   * say something more useful than "wrong password".
   */
  readonly awaitingEmailConfirmation: boolean;
  /** Display text only. `user_metadata` is user-writable. */
  readonly displayName: string;

  signIn(params: auth.SignInParams): Promise<ActionResult<Session>>;
  signUp(params: auth.SignUpParams): Promise<ActionResult<auth.SignUpOutcome>>;
  signOut(): Promise<ActionResult<undefined>>;
  requestPasswordReset(email: string): Promise<ActionResult<undefined>>;
  updatePassword(password: string): Promise<ActionResult<undefined>>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [session, setSession] = useState<Session | null>(null);
  const [awaitingEmailConfirmation, setAwaitingEmailConfirmation] = useState(false);

  /**
   * Guards against a state update after unmount, and against the initial
   * `getSession()` resolving *after* an auth event has already produced a newer
   * answer — a real race on a slow cold start.
   */
  const hasResolved = useRef(false);

  useEffect(() => {
    let active = true;

    // Subscribed BEFORE the first read, so an event that fires during
    // restoration is not missed.
    const unsubscribe = auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      hasResolved.current = true;
      setSession(nextSession);
      setStatus(nextSession === null ? 'signedOut' : 'signedIn');
      if (nextSession !== null) setAwaitingEmailConfirmation(false);

      // PASSWORD_RECOVERY means the user arrived from a recovery email and now
      // holds a short-lived session whose only purpose is setting a new password.
      // The router treats it as signed in, which is what lets the reset screen
      // work; the screen itself is what limits the session's usefulness.
      if (event === 'PASSWORD_RECOVERY') {
        log.info('Recovery session established');
      }
    });

    void auth.getSession().then((result) => {
      if (!active) return;
      // An auth event beat us to it — its answer is newer than ours.
      if (hasResolved.current) return;

      if (!result.ok) {
        // A failed restore is not a signed-in state. Reporting `signedOut` sends
        // the user to a screen that works rather than to a dashboard that cannot
        // load anything.
        log.warn('Session restore failed', { code: result.error.code });
        setStatus('signedOut');
        return;
      }
      hasResolved.current = true;
      setSession(result.value);
      setStatus(result.value === null ? 'signedOut' : 'signedIn');
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  /**
   * Token refresh timers are unreliable while an app is backgrounded on native,
   * so refresh is suspended and resumed with the app's own lifecycle. Without
   * this, a session can look valid on resume and then fail on the first query.
   */
  useEffect(() => {
    function handleAppStateChange(next: AppStateStatus): void {
      if (next === 'active') {
        auth.startAutoRefresh();
      } else {
        auth.stopAutoRefresh();
      }
    }

    // The listener only fires on change, so the current state is applied once up
    // front — otherwise a cold start into the foreground never starts refreshing.
    handleAppStateChange(AppState.currentState);
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      auth.stopAutoRefresh();
    };
  }, []);

  const signIn = useCallback(async (params: auth.SignInParams) => {
    const result = await auth.signIn(params);
    // The screen renders the message; the provider only records the fact, so the
    // sign-in form can offer to resend a confirmation instead of insisting the
    // password is wrong.
    setAwaitingEmailConfirmation(!result.ok && result.error.code === 'AUTH_EMAIL_NOT_CONFIRMED');
    return result;
  }, []);

  const signUp = useCallback(async (params: auth.SignUpParams) => {
    const result = await auth.signUp(params);
    if (result.ok) setAwaitingEmailConfirmation(result.value.needsEmailConfirmation);
    return result;
  }, []);

  const signOutAction = useCallback(async () => {
    const result = await auth.signOut();
    // Local state is cleared even when the network call failed: the tokens are
    // already gone from storage, so continuing to render a session would be a
    // lie the next query would expose anyway.
    setSession(null);
    setStatus('signedOut');
    setAwaitingEmailConfirmation(false);
    return result;
  }, []);

  const requestPasswordReset = useCallback((email: string) => auth.requestPasswordReset(email), []);
  const updatePassword = useCallback((password: string) => auth.updatePassword(password), []);

  const user = session?.user ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user,
      isSignedIn: status === 'signedIn',
      awaitingEmailConfirmation,
      displayName: auth.displayNameFor(user),
      signIn,
      signUp,
      signOut: signOutAction,
      requestPasswordReset,
      updatePassword,
    }),
    [
      status,
      session,
      user,
      awaitingEmailConfirmation,
      signIn,
      signUp,
      signOutAction,
      requestPasswordReset,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }
  return context;
}
