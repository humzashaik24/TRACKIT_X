/**
 * Trackit X — authentication service.
 *
 * The only module that talks to Supabase Auth. Screens call these functions;
 * nothing under `app/` imports `@/lib/supabase` (lint enforces it). That keeps
 * error normalisation, redirect construction and the "never leak provider text"
 * rule in one auditable place instead of copied into six screens.
 *
 * Every function returns an `ActionResult` rather than throwing, so a screen
 * cannot forget to handle failure — `strict` mode makes ignoring the union a
 * compile error.
 *
 * ── What this service does NOT do ───────────────────────────────────────────
 * It does not decide what a user may see or change. Authentication answers "who
 * is this"; authorisation is Row Level Security's job and is enforced in Postgres
 * on every request. A session obtained here grants nothing by itself.
 */
import type { AuthChangeEvent, Session, Subscription, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { exchangeAuthCode, startAutoRefresh, stopAutoRefresh, supabase } from '@/lib/supabase';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, okVoid, type ActionResult } from '@/utils/result';

const log = logger.child({ module: 'authService' });

/**
 * Re-exported so a consumer never has to reach for `@/lib/supabase` just to
 * manage the refresh timer. The client module stays a leaf that only this
 * service layer imports.
 */
export { startAutoRefresh, stopAutoRefresh };

/**
 * Must match `expo.scheme` in app.json AND the `trackitx://…` entries in
 * `supabase/config.toml` → `auth.additional_redirect_urls`. Supabase matches the
 * redirect target EXACTLY; a mismatch is rejected at the Auth server, which
 * surfaces to the user as a dead link in their email.
 */
const APP_SCHEME = 'trackitx';

/** The path the recovery email lands on. Also listed in `additional_redirect_urls`. */
const RESET_PASSWORD_PATH = 'reset-password';

/**
 * Builds the exact URL a Supabase email link may return to.
 *
 * `Linking.createURL()` is deliberately not used: in a development build it
 * interpolates the dev server's host into the deep link
 * (`trackitx://192.168.1.5:8081/reset-password`), which is not one of the four
 * URLs in the allow list, so the link would be refused. Composing the two
 * possibilities by hand keeps this in step with the config file, at the cost of
 * having to keep them in step by hand.
 */
function redirectTo(path: string): string {
  if (Platform.OS === 'web') {
    // `window` is absent during static web rendering; the site URL from the
    // config is the correct fallback there.
    const origin = typeof window === 'undefined' ? 'http://localhost:8081' : window.location.origin;
    return `${origin}/${path}`;
  }
  return `${APP_SCHEME}://${path}`;
}

export interface SignUpParams {
  email: string;
  password: string;
  fullName: string;
}

export interface SignInParams {
  email: string;
  password: string;
}

export interface SignUpOutcome {
  /**
   * True when the account still needs an email confirmation before it can sign
   * in. Derived from the absence of a session, which is what
   * `enable_confirmations = true` produces.
   */
  readonly needsEmailConfirmation: boolean;
  readonly session: Session | null;
}

/**
 * Creates an account.
 *
 * `fullName` goes into `user_metadata`, which the user controls and which is
 * therefore treated as display text only — never as an authorisation input. Roles
 * live in `organization_members`, where the user cannot write them.
 *
 * On an email that already exists, Supabase (with confirmations on) returns a
 * success-shaped response with no identities rather than an error, so an attacker
 * cannot use this endpoint to enumerate accounts. That behaviour is preserved
 * here: the caller is told to check their email either way.
 */
export async function signUp(params: SignUpParams): Promise<ActionResult<SignUpOutcome>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        data: { full_name: params.fullName },
        emailRedirectTo: redirectTo(''),
      },
    });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    // The email is NOT logged: it is personal data and, in a log that might be
    // shipped somewhere, an account list.
    log.warn('Sign-up failed', { code: result.error.code });
    return result;
  }

  return ok({
    needsEmailConfirmation: result.value.session === null,
    session: result.value.session,
  });
}

export async function signIn(params: SignInParams): Promise<ActionResult<Session>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Sign-in failed', { code: result.error.code });
    return result;
  }

  if (result.value.session === null) {
    // Should not happen for a password grant, but the type allows it and a null
    // session silently treated as success would present a signed-out app as
    // signed in.
    return err(appError('AUTH_INVALID_CREDENTIALS', 'Password grant returned no session'));
  }

  return ok(result.value.session);
}

/**
 * Ends the session.
 *
 * `scope: 'local'` clears this device only. Signing every device out of a shared
 * workshop tablet because one person left for the day is the wrong default; a
 * deliberate "sign out everywhere" belongs in security settings.
 */
export async function signOut(): Promise<ActionResult<undefined>> {
  const result = await attempt(async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Sign-out failed', { code: result.error.code });
    return result;
  }
  return okVoid;
}

/** The stored session, refreshed if it was expiring. `null` when signed out. */
export async function getSession(): Promise<ActionResult<Session | null>> {
  return attempt(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error !== null) throw error;
    return data.session;
  }, 'NETWORK_UNAVAILABLE');
}

/**
 * Re-validates the session against the Auth server.
 *
 * `getSession` reads local storage and trusts what it finds; this asks the server.
 * Worth the round trip when a decision depends on the account still existing.
 */
export async function getUser(): Promise<ActionResult<User | null>> {
  return attempt(async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error !== null) throw error;
    return data.user;
  }, 'NETWORK_UNAVAILABLE');
}

/**
 * Sends a password-recovery email.
 *
 * Always reports success. Supabase does not disclose whether the address exists,
 * and neither does this: a form that says "no such account" is a free account
 * checker. The user is told the email was sent if such an account exists.
 */
export async function requestPasswordReset(email: string): Promise<ActionResult<undefined>> {
  const result = await attempt(async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo(RESET_PASSWORD_PATH),
    });
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Password reset request failed', { code: result.error.code });
    return result;
  }
  return okVoid;
}

/**
 * Sets a new password.
 *
 * Requires a live session — either an ordinary one (changing a known password) or
 * the recovery session Supabase establishes when the emailed link is opened. This
 * is why the reset screen must wait for that session before enabling its form.
 */
export async function updatePassword(password: string): Promise<ActionResult<undefined>> {
  const result = await attempt(async () => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Password update failed', { code: result.error.code });
    return result;
  }
  log.info('Password updated');
  return okVoid;
}

/**
 * Completes a PKCE exchange from a deep link.
 *
 * Only needed on native. On web the client consumes the code itself via
 * `detectSessionInUrl`.
 */
export async function completeAuthLink(code: string): Promise<ActionResult<undefined>> {
  const result = await attempt(() => exchangeAuthCode(code), 'DEPENDENCY_FAILED');
  if (!result.ok) {
    log.warn('Auth code exchange failed', { code: result.error.code });
    return result;
  }
  return okVoid;
}

export type AuthEventHandler = (event: AuthChangeEvent, session: Session | null) => void;

/**
 * Subscribes to sign-in, sign-out, token refresh and recovery events.
 *
 * Returns the unsubscribe function directly, so a `useEffect` can return it
 * without unwrapping Supabase's nested `data.subscription` shape.
 */
export function onAuthStateChange(handler: AuthEventHandler): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // The event name is safe to log; the session is not — it carries tokens.
    log.debug('Auth state changed', { event });
    handler(event, session);
  });
  const subscription: Subscription = data.subscription;
  return () => subscription.unsubscribe();
}

/**
 * The display name for a user, best effort.
 *
 * `user_metadata` is user-writable, so this is presentation only. Falls back to
 * the email local part, then to a neutral label — never to an empty string, which
 * renders as a gap where a name should be.
 */
export function displayNameFor(user: User | null): string {
  if (user === null) return 'Signed out';

  const metadata = user.user_metadata as Record<string, unknown> | null;
  const fullName = metadata === null ? undefined : metadata['full_name'];
  if (typeof fullName === 'string' && fullName.trim().length > 0) return fullName.trim();

  const email = user.email;
  if (typeof email === 'string' && email.includes('@')) {
    const [local] = email.split('@');
    if (local !== undefined && local.length > 0) return local;
  }

  return 'Your account';
}
