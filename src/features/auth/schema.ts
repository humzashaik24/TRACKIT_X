/**
 * Trackit X — authentication form schemas.
 *
 * Zod schemas for the four auth forms, plus a small helper that turns a parse
 * failure into the per-field map the design system's `Input` expects.
 *
 * ⚠ These rules MIRROR the server; they do not implement it. Supabase Auth
 *   applies its own password policy (`supabase/config.toml` →
 *   `minimum_password_length = 10`, `password_requirements =
 *   "lower_upper_letters_digits"`) and its own email validation on every request,
 *   including requests that never touch this file. Validating here buys the user
 *   an instant, specific error instead of a round trip — nothing more.
 *
 *   The constants below therefore have a duty: if the config changes, change
 *   them, or the form will accept a password the server rejects and the failure
 *   will surface as an unexplained error on submit.
 */
import { z } from 'zod';

/** Mirrors `minimum_password_length` in `supabase/config.toml`. */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Supabase enforces a 72-byte ceiling (bcrypt's limit). Stated in characters,
 * which under-counts for multi-byte input — deliberately conservative, since the
 * alternative is a truncated password that still signs in.
 */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * Human-readable form of `password_requirements = "lower_upper_letters_digits"`,
 * shown under the field *before* the user types rather than as an error after.
 */
export const PASSWORD_RULE_HINT =
  `At least ${PASSWORD_MIN_LENGTH} characters, with an uppercase letter, ` +
  'a lowercase letter and a number.';

const emailField = z
  .email({ message: 'Enter a valid email address.' })
  .trim()
  .max(320, { message: 'That email address is too long.' })
  // Supabase lowercases the address on its side; doing it here means "Ann@x.com"
  // and "ann@x.com" cannot look like two different accounts in this UI.
  .toLowerCase();

/**
 * Sign-in only checks that something was typed.
 *
 * Applying the full policy here would be a downgrade, not a safety measure: an
 * account created before a policy change must still be able to sign in, and a
 * "your password is too short" message on a *sign-in* form tells an attacker
 * something about the stored credential.
 */
const signInPasswordField = z.string().min(1, { message: 'Enter your password.' });

const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    message: `Keep it under ${PASSWORD_MAX_LENGTH} characters.`,
  })
  .regex(/\p{Ll}/u, { message: 'Include a lowercase letter.' })
  .regex(/\p{Lu}/u, { message: 'Include an uppercase letter.' })
  .regex(/[0-9]/, { message: 'Include a number.' });

const fullNameField = z
  .string()
  .trim()
  .min(2, { message: 'Enter your name.' })
  .max(120, { message: 'That name is too long.' });

export const signInSchema = z.object({
  email: emailField,
  password: signInPasswordField,
});

export const signUpSchema = z
  .object({
    fullName: fullNameField,
    email: emailField,
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  // Attached to `confirmPassword` rather than the object so the message renders
  // under the field the user needs to fix.
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Both passwords must match.',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Both passwords must match.',
    path: ['confirmPassword'],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** One message per field — what a form needs to render inline errors. */
export type FieldErrors<T> = Partial<Record<keyof T & string, string>>;

/**
 * Collapses a Zod failure into the first message per field.
 *
 * First rather than all: the password rules are checked in order, so showing
 * every unmet rule at once produces a wall of red. The user fixes one thing,
 * submits, and sees the next.
 */
export function fieldErrorsFrom<T>(error: z.ZodError<T>): FieldErrors<T> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const [field] = issue.path;
    if (typeof field !== 'string') continue;
    if (errors[field] === undefined) errors[field] = issue.message;
  }
  return errors as FieldErrors<T>;
}

/**
 * A parse result shaped for a form: either the cleaned values, or a per-field
 * error map. Returning both in one union keeps the caller from having to know
 * anything about Zod.
 */
export type FormValidation<T> =
  | { readonly ok: true; readonly values: T }
  | { readonly ok: false; readonly errors: FieldErrors<T> };

export function validateForm<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): FormValidation<z.infer<Schema>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, values: result.data };
  return { ok: false, errors: fieldErrorsFrom<z.infer<Schema>>(result.error) };
}
