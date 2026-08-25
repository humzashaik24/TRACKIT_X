/**
 * Trackit X — result values for operations that are expected to fail.
 *
 * Services return an `ActionResult` instead of throwing. The reason is not style:
 * a thrown error is invisible in a function's type, so nothing forces a screen to
 * handle it, and the failure surfaces as a crash or a silently dead button. A
 * returned union makes the failure part of the signature, and `strict` mode makes
 * ignoring it a compile error.
 *
 * Errors carried here are always `AppError`, so a screen renders
 * `result.error.userMessage` and never a raw provider string. Normalisation
 * happens once, at the boundary, in `attempt`.
 *
 * Throwing is still correct for programmer error — a missing provider, an
 * impossible branch. Those are bugs to fix, not conditions to render.
 */
import { toAppError, type AppError, type AppErrorCode } from './errors';

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err {
  readonly ok: false;
  readonly error: AppError;
}

export type ActionResult<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** For operations whose success carries no value, e.g. sign-out. */
export const okVoid: Ok<undefined> = { ok: true, value: undefined };

/**
 * Wraps a failure. Accepts an unknown thrown value and normalises it, so callers
 * never have to construct an `AppError` by hand at a catch site.
 */
export function err(cause: unknown, fallbackCode: AppErrorCode = 'UNKNOWN'): Err {
  return { ok: false, error: toAppError(cause, fallbackCode) };
}

export function isOk<T>(result: ActionResult<T>): result is Ok<T> {
  return result.ok;
}

export function isErr<T>(result: ActionResult<T>): result is Err {
  return !result.ok;
}

/**
 * Runs an async operation and converts any thrown value into an `Err`.
 *
 * This is the single place an exception becomes a result, which is what keeps
 * `toAppError` from being scattered through every service method.
 *
 * @param operation    the work to attempt
 * @param fallbackCode the code to assume when the failure carries no recognisable
 *                     shape — pick the most likely cause for the call site, e.g.
 *                     `NETWORK_UNAVAILABLE` for a fetch
 */
export async function attempt<T>(
  operation: () => Promise<T>,
  fallbackCode: AppErrorCode = 'UNKNOWN',
): Promise<ActionResult<T>> {
  try {
    return ok(await operation());
  } catch (cause) {
    return err(cause, fallbackCode);
  }
}

/** The value, or `fallback` when the operation failed. */
export function unwrapOr<T>(result: ActionResult<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Applies `transform` to a successful value, passing failures through untouched.
 * Useful for reshaping a row into a domain object without unwrapping first.
 */
export function mapOk<T, U>(result: ActionResult<T>, transform: (value: T) => U): ActionResult<U> {
  return result.ok ? ok(transform(result.value)) : result;
}
