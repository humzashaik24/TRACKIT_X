/**
 * Presentation formatting.
 *
 * Every number and date a user reads passes through here. Three rules shape the
 * module:
 *
 *  1. **Money arrives as integer minor units.** Rupees-as-float is a rounding bug
 *     with a delay fuse: `0.1 + 0.2` is not `0.3`, and a payroll total assembled
 *     from floats drifts. The database stores minor units (paise, cents); these
 *     functions divide only at the last moment, for display.
 *  2. **Formatting never computes.** A payroll total, a stock balance and a health
 *     score are authoritative values produced elsewhere. Nothing here re-derives a
 *     figure — it only renders one. `formatPercent` takes the ratio; it does not
 *     divide two numbers for you.
 *  3. **Locale, currency and time zone are organization settings**, not constants.
 *     They are injected once at startup via {@link configureFormatting} and can be
 *     overridden per call. No caller should ever pass a literal `'₹'`.
 *
 * `Intl.NumberFormat` and `Intl.DateTimeFormat` are used where Hermes and every
 * browser support them. `Intl.RelativeTimeFormat`, `Intl.PluralRules` and
 * `Intl.ListFormat` are NOT: Hermes ships a partial Intl, so relative time,
 * pluralisation and list joining are implemented here rather than crashing on a
 * device that lacks them.
 */

/** Unicode minus (U+2212), not a hyphen. Aligns with digits; reads as a sign. */
const MINUS = '−';
/** Non-breaking space, so a value never wraps away from its unit. */
const NBSP = ' ';

export interface FormattingConfig {
  /** BCP 47 tag, e.g. `'en-IN'`. */
  readonly locale: string;
  /** ISO 4217 code, e.g. `'INR'`. */
  readonly currency: string;
  /** IANA zone, e.g. `'Asia/Kolkata'`. Dates are stored in UTC and read here. */
  readonly timeZone: string;
}

/**
 * Deliberately conservative defaults. They are replaced by the organization's own
 * settings at sign-in; if that ever fails, an Indian MSME sees plausible output
 * rather than an American one.
 */
const DEFAULTS: FormattingConfig = {
  locale: 'en-IN',
  currency: 'INR',
  timeZone: 'Asia/Kolkata',
};

let config: FormattingConfig = DEFAULTS;

/** Applies the organization's locale settings. Call once, from the org context. */
export function configureFormatting(next: Partial<FormattingConfig>): void {
  config = { ...config, ...next };
  // Cached formatters are keyed by locale, so a locale change must invalidate them.
  numberFormatters.clear();
  dateFormatters.clear();
  separatorCache.clear();
}

/** Restores defaults. Used by tests and at sign-out. */
export function resetFormatting(): void {
  config = DEFAULTS;
  numberFormatters.clear();
  dateFormatters.clear();
  separatorCache.clear();
}

export function formattingConfig(): FormattingConfig {
  return config;
}

// --- Intl plumbing ---------------------------------------------------------

// Constructing an Intl formatter is expensive relative to using one, and a table
// of 500 rows would construct one per cell. They are cached by their full option
// set and cleared when the locale changes.
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat | undefined {
  const key = `${config.locale}|${JSON.stringify(options)}`;
  const cached = numberFormatters.get(key);
  if (cached !== undefined) return cached;
  try {
    const created = new Intl.NumberFormat(config.locale, options);
    numberFormatters.set(key, created);
    return created;
  } catch {
    // An unknown currency code or a runtime without full Intl. The caller falls
    // back to a plain grouped string rather than showing nothing.
    return undefined;
  }
}

/**
 * @param timeZone passed explicitly rather than read from config, because a
 * date-only value is rendered in UTC no matter what zone the organization is in.
 * See {@link zoneFor}.
 */
function dateFormatter(
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormat | undefined {
  const key = `${config.locale}|${timeZone}|${JSON.stringify(options)}`;
  const cached = dateFormatters.get(key);
  if (cached !== undefined) return cached;
  try {
    const created = new Intl.DateTimeFormat(config.locale, { timeZone, ...options });
    dateFormatters.set(key, created);
    return created;
  } catch {
    return undefined;
  }
}

/** The grouping and decimal characters the configured locale actually uses. */
interface Separators {
  readonly group: string;
  readonly decimal: string;
}

const separatorCache = new Map<string, Separators>();

/**
 * Asks the locale which character groups and which separates the fraction.
 *
 * This is the only thing that can resolve `1,000` from `1.005`: both are one
 * separator followed by three digits, and only the locale knows which character
 * means which. Falls back to the majority convention when `formatToParts` is
 * missing, as it is on some Hermes builds.
 */
function localeSeparators(): Separators {
  const cached = separatorCache.get(config.locale);
  if (cached !== undefined) return cached;

  let resolved: Separators = { group: ',', decimal: '.' };
  try {
    const parts = new Intl.NumberFormat(config.locale).formatToParts(12345.6);
    const group = parts.find((part) => part.type === 'group')?.value;
    const decimal = parts.find((part) => part.type === 'decimal')?.value;
    resolved = {
      // Some locales group with a narrow no-break space (fr-FR). That is stripped
      // as whitespace before parsing, so only `.` and `,` are meaningful here.
      group: group === '.' || group === ',' ? group : ',',
      decimal: decimal === '.' || decimal === ',' ? decimal : '.',
    };
  } catch {
    // Partial Intl. The default already covers en-*, which is the shipping locale.
  }
  separatorCache.set(config.locale, resolved);
  return resolved;
}

/**
 * ISO 4217 exponents that are not 2.
 *
 * A hardcoded table beats asking Intl, because being wrong here shows a figure
 * 100× off. The list is short, stable, and standards-defined — it is not business
 * logic. Anything absent uses 2 decimal places.
 */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

/** How many minor units make one major unit of `currency`. */
export function minorUnitExponent(currency: string = config.currency): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Minor units → major units, as an exact-enough number for display only. */
export function toMajorUnits(minorUnits: number, currency: string = config.currency): number {
  return minorUnits / 10 ** minorUnitExponent(currency);
}

// --- Money -----------------------------------------------------------------

export interface MoneyOptions {
  currency?: string;
  /** Drops the decimal part. For totals in headings, never in a payslip. */
  whole?: boolean;
  /** `'code'` renders `INR 1,200.00`; `'symbol'` renders `₹1,200.00`. */
  display?: 'symbol' | 'code' | 'none';
  /** Always shows a sign, so `+` marks a credit as clearly as `−` marks a debit. */
  signed?: boolean;
}

/**
 * Formats an integer amount of minor units.
 *
 * @param minorUnits paise / cents, as stored. A non-integer is a caller bug and is
 * rounded rather than silently rendered with phantom precision.
 */
export function formatMoney(minorUnits: number, options: MoneyOptions = {}): string {
  const currency = options.currency ?? config.currency;
  if (!Number.isFinite(minorUnits)) return em();

  const rounded = Math.round(minorUnits);
  const exponent = minorUnitExponent(currency);
  const digits = options.whole === true ? 0 : exponent;
  const value = toMajorUnits(Math.abs(rounded), currency);

  const style = options.display === 'none' ? undefined : 'currency';
  const formatter = numberFormatter({
    ...(style === 'currency'
      ? {
          style: 'currency',
          currency,
          currencyDisplay: options.display === 'code' ? 'code' : 'symbol',
        }
      : {}),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  const body = formatter?.format(value) ?? `${groupDigits(value.toFixed(digits))}`;
  return applySign(body, rounded, options.signed === true);
}

/**
 * Short money for dense tiles: `₹12.4L`, `₹1.2Cr`, `$4.5M`.
 *
 * Never use this where the exact figure matters — a payslip, an invoice, a payroll
 * register, an audit view. It is for a KPI tile where the trend is the message.
 */
export function formatMoneyCompact(minorUnits: number, options: MoneyOptions = {}): string {
  const currency = options.currency ?? config.currency;
  if (!Number.isFinite(minorUnits)) return em();

  const rounded = Math.round(minorUnits);
  const value = toMajorUnits(Math.abs(rounded), currency);
  const formatter = numberFormatter({
    style: 'currency',
    currency,
    currencyDisplay: options.display === 'code' ? 'code' : 'symbol',
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  const body = formatter?.format(value) ?? formatMoney(Math.abs(rounded), { ...options, whole: true });
  return applySign(body, rounded, options.signed === true);
}

/** A grouping run is always exactly this many digits, in every convention. */
const GROUP_RUN = 3;

function occurrences(text: string, character: string): number {
  let count = 0;
  for (const char of text) if (char === character) count += 1;
  return count;
}

/**
 * True when `digits` is grouped the way some real convention groups.
 *
 * Accepts Western `1,234,567` and Indian `12,34,567` — the lakh/crore system groups
 * 2,2,3 from the right, so an intermediate run of two is correct here where a purely
 * Western check would reject it. The final run is always three; the leading one is
 * whatever is left over.
 */
function groupingIsWellFormed(digits: string, separator: string): boolean {
  const runs = digits.split(separator);
  if (runs.length < 2) return true;
  const first = (runs[0] as string).length;
  if (first < 1 || first > GROUP_RUN) return false;
  for (let index = 1; index < runs.length; index += 1) {
    const run = (runs[index] as string).length;
    const ok = index === runs.length - 1 ? run === GROUP_RUN : run === 2 || run === GROUP_RUN;
    if (!ok) return false;
  }
  return true;
}

/** The integer and fraction digit strings of a parsed amount. */
interface AmountParts {
  readonly whole: string;
  readonly fraction: string;
}

/**
 * Decides which separator in `unsigned` is the decimal point, then validates the rest
 * as grouping. Returns `undefined` when no reading is valid.
 *
 * The rules, in the order applied:
 *
 *  - Both `.` and `,` present → the rightmost kind is the decimal and the other is
 *    grouping. This is what tells `1,234.56` from `1.234,56` with no locale at all.
 *  - One kind, appearing more than once → grouping. Nothing else produces `1.234.567`.
 *  - One kind, appearing once, with a trailing run that is *not* three digits →
 *    decimal. A grouping run is always three, so this cannot be grouping. Decimal is
 *    also the safe direction to err in: mistaking a decimal point for a group
 *    separator multiplies the amount by a thousand.
 *  - One kind, appearing once, with exactly three trailing digits → genuinely
 *    ambiguous. `1,000` and `1.005` are the same shape and only the locale knows
 *    which character means which, so the locale is asked.
 *
 * Whatever remains in the integer part must then be well-formed grouping using one
 * consistent character. `1,2345` and `1.2,3` are typing errors, not amounts.
 */
function splitAmount(unsigned: string): AmountParts | undefined {
  const dots = occurrences(unsigned, '.');
  const commas = occurrences(unsigned, ',');

  let decimal: string | undefined;
  if (dots > 0 && commas > 0) {
    decimal = unsigned.lastIndexOf('.') > unsigned.lastIndexOf(',') ? '.' : ',';
    // A decimal point occurs once by definition. `1.2,3.4` is not a number.
    if (occurrences(unsigned, decimal) !== 1) return undefined;
  } else if (dots + commas === 1) {
    const separator = dots === 1 ? '.' : ',';
    const trailing = unsigned.length - unsigned.lastIndexOf(separator) - 1;
    if (trailing !== GROUP_RUN || separator === localeSeparators().decimal) decimal = separator;
  }

  const decimalAt = decimal === undefined ? -1 : unsigned.lastIndexOf(decimal);
  const whole = decimalAt === -1 ? unsigned : unsigned.slice(0, decimalAt);
  const fraction = decimalAt === -1 ? '' : unsigned.slice(decimalAt + 1);
  // The fraction is digits only; a separator after the decimal point is malformed.
  if (/[^\d]/.test(fraction)) return undefined;

  const separators = whole.replace(/\d/g, '');
  if (separators !== '') {
    const groupChar = separators[0] as string;
    if (separators !== groupChar.repeat(separators.length)) return undefined;
    if (!groupingIsWellFormed(whole, groupChar)) return undefined;
  }

  return { whole: whole.replace(/[.,]/g, ''), fraction };
}

/**
 * Parses typed text into integer minor units.
 *
 * Done by string surgery, not `parseFloat(text) * 100`: the multiply reintroduces
 * exactly the float error the minor-unit representation exists to avoid (`19.99 *
 * 100` is `1998.9999999999998`). Returns `undefined` for anything unparseable so
 * a form can show a validation message instead of storing a zero.
 *
 * More precision than the currency has is rejected, not truncated. `1.005` is not
 * ₹1.00, and it is emphatically not ₹1,005 — it is an amount this field cannot
 * hold, and the only honest answer is to make the user correct it. See
 * {@link splitAmount} for how a separator is classified.
 */
export function parseMoneyToMinorUnits(text: string, currency?: string): number | undefined {
  const exponent = minorUnitExponent(currency ?? config.currency);
  // Strip currency symbols, letters and every kind of space — `\s` already covers
  // the no-break and narrow no-break spaces some locales group with. Sign, digits
  // and separators survive for splitAmount to classify.
  const cleaned = text
    .trim()
    .replace(/\s/g, '')
    .replace(/[^\d.,\-−+]/g, '')
    .replace(/−/g, '-');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return undefined;

  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');
  // A sign anywhere but the front, or no digit at all: `1-2`, `--5`, `.`, `,`.
  if (!/^[\d.,]+$/.test(unsigned) || !/\d/.test(unsigned)) return undefined;

  const parts = splitAmount(unsigned);
  if (parts === undefined) return undefined;
  const { whole, fraction } = parts;
  if (whole === '' && fraction === '') return undefined;
  // More decimal places than the currency has. Truncating would silently alter the
  // amount, so the input is refused instead.
  if (fraction.length > exponent) return undefined;

  const padded = (fraction + '0'.repeat(exponent)).slice(0, exponent);
  const minorUnits = Number.parseInt((whole === '' ? '0' : whole) + padded, 10);
  if (!Number.isSafeInteger(minorUnits)) return undefined;
  return negative ? -minorUnits : minorUnits;
}

// --- Plain numbers ---------------------------------------------------------

export interface NumberOptions {
  /** Fixed decimal places. Omitted means "up to 2, trailing zeros trimmed". */
  decimals?: number;
  signed?: boolean;
}

export function formatNumber(value: number, options: NumberOptions = {}): string {
  if (!Number.isFinite(value)) return em();
  const decimals = options.decimals;
  const formatter = numberFormatter(
    decimals === undefined
      ? { maximumFractionDigits: 2 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
  );
  const body =
    formatter?.format(Math.abs(value)) ??
    groupDigits(Math.abs(value).toFixed(decimals ?? 2).replace(/\.?0+$/, ''));
  return applySign(body, value, options.signed === true);
}

/** `1.2K`, `3.4M`. For axis ticks and tiles, not for figures that must reconcile. */
export function formatCompactNumber(value: number, options: NumberOptions = {}): string {
  if (!Number.isFinite(value)) return em();
  const formatter = numberFormatter({ notation: 'compact', maximumFractionDigits: 1 });
  const body = formatter?.format(Math.abs(value)) ?? formatNumber(Math.abs(value));
  return applySign(body, value, options.signed === true);
}

/**
 * Formats a ratio as a percentage.
 *
 * @param ratio `0.084` → `8.4%`. Pass the ratio, not the percentage: taking
 * `8.4` here and rendering `8.4%` would work by luck and break the day a caller
 * passes a real ratio.
 */
export function formatPercent(ratio: number, options: NumberOptions = {}): string {
  if (!Number.isFinite(ratio)) return em();
  const decimals = options.decimals ?? 1;
  const formatter = numberFormatter({
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const body = formatter?.format(Math.abs(ratio)) ?? `${Math.abs(ratio * 100).toFixed(decimals)}%`;
  return applySign(body, ratio, options.signed === true);
}

/**
 * Formats a difference already expressed in percentage points.
 *
 * A margin moving from 20% to 23% rose three *points*, not three percent. Mixing
 * the two is the classic reporting error, so they are separate functions.
 */
export function formatPercentagePoints(points: number, options: NumberOptions = {}): string {
  if (!Number.isFinite(points)) return em();
  const decimals = options.decimals ?? 1;
  const body = `${formatNumber(Math.abs(points), { decimals })}${NBSP}pp`;
  return applySign(body, points, options.signed !== false);
}

/** A signed change for a metric tile: `+12.4%`, `−3`, `0`. */
export function formatDelta(value: number, options: NumberOptions = {}): string {
  if (!Number.isFinite(value)) return em();
  if (value === 0) return formatNumber(0, options);
  return formatNumber(value, { ...options, signed: true });
}

/** A count with its unit: `40 units`, `1 unit`. */
export function formatQuantity(value: number, unit: string, pluralUnit?: string): string {
  if (!Number.isFinite(value)) return em();
  const label = Math.abs(value) === 1 ? unit : (pluralUnit ?? pluralise(unit));
  return `${formatNumber(value)}${NBSP}${label}`;
}

/** `1.4 MB`. Binary prefixes, because storage quotas are quoted in them. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return em();
  if (bytes < 1024) return `${Math.round(bytes)}${NBSP}B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${formatNumber(value, { decimals: value < 10 ? 1 : 0 })}${NBSP}${units[index]}`;
}

// --- Dates and time --------------------------------------------------------

export type DateInput = Date | string | number | null | undefined;

/**
 * The exact shape Postgres returns for a `date` column.
 *
 * This is the only signal available at this layer that distinguishes the two types,
 * and it is a reliable one: `date` serialises as `YYYY-MM-DD` and `timestamp` /
 * `timestamptz` always carry a time part.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A resolved date plus whether it is a calendar date or an instant.
 *
 * Postgres `date` and `timestamptz` are different kinds of thing and must be
 * rendered differently. A `timestamptz` is an **instant**: `09:30Z` is `15:00` in
 * Kolkata, and converting it into the reader's zone is the entire point. A `date` is
 * a **calendar date** with no time and no zone: an invoice dated the 23rd is dated
 * the 23rd in every office on earth. Converting it is a category error, and it shows
 * the wrong day to every reader west of UTC.
 */
interface ResolvedDate {
  readonly date: Date;
  readonly dateOnly: boolean;
}

function resolveDate(value: DateInput): ResolvedDate | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : { date: value, dateOnly: false };
  }
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? undefined : { date: fromNumber, dateOnly: false };
  }
  const text = value.trim();
  if (text === '') return undefined;
  const dateOnly = DATE_ONLY.test(text);
  const parsed = new Date(dateOnly ? `${text}T00:00:00Z` : text);
  return Number.isNaN(parsed.getTime()) ? undefined : { date: parsed, dateOnly };
}

/**
 * Coerces the shapes a date arrives in, discarding the calendar/instant distinction.
 *
 * Kept for the callers that only need the point on the timeline. Anything that
 * *renders* must use {@link resolveDate} instead, or a calendar date will be shifted
 * into a zone it was never in.
 */
function toDate(value: Date | string | number | null | undefined): Date | undefined {
  return resolveDate(value)?.date;
}

/**
 * The zone a resolved value is rendered in.
 *
 * A calendar date is held at midnight UTC, so reading its parts back in UTC returns
 * the date that was stored, unshifted — this is a round trip through the same frame,
 * not an arbitrary anchor. An instant is read in the organization's zone, because
 * that is the wall clock the event happened on.
 */
function zoneFor(resolved: ResolvedDate): string {
  return resolved.dateOnly ? 'UTC' : config.timeZone;
}

function renderDate(resolved: ResolvedDate, options: Intl.DateTimeFormatOptions): string {
  const formatter = dateFormatter(options, zoneFor(resolved));
  return formatter?.format(resolved.date) ?? resolved.date.toISOString().slice(0, 10);
}

function withFormatter(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  const resolved = resolveDate(value);
  if (resolved === undefined) return em();
  return renderDate(resolved, options);
}

/** `23 Aug 2026` — unambiguous across locales, unlike any all-numeric form. */
const FULL_DATE: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
};

/** `23 Aug 2026` — unambiguous across locales, unlike any all-numeric form. */
export function formatDate(value: DateInput): string {
  return withFormatter(value, FULL_DATE);
}

/** `23 Aug` — for a chart axis or a dense row where the year is implied. */
export function formatDateShort(value: DateInput): string {
  return withFormatter(value, { day: '2-digit', month: 'short' });
}

export function formatDateLong(value: DateInput): string {
  return withFormatter(value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatTime(value: DateInput): string {
  return withFormatter(value, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(value: DateInput): string {
  return withFormatter(value, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `Aug 2026` — a payroll period, a monthly bucket. */
export function formatMonth(value: DateInput): string {
  return withFormatter(value, { month: 'short', year: 'numeric' });
}

/** The `YYYY-MM-DD` a Postgres `date` column expects. Never locale-formatted. */
export function toDateKey(value: DateInput): string | undefined {
  const date = toDate(value);
  if (date === undefined) return undefined;
  return date.toISOString().slice(0, 10);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * `just now`, `12 minutes ago`, `in 3 days`, then an absolute date past a month.
 *
 * Hand-rolled rather than `Intl.RelativeTimeFormat`, which Hermes does not ship.
 * Past roughly a month, relative time stops being informative — "2 months ago"
 * is worse than the date — so it falls through to {@link formatDate}.
 *
 * @param now injectable so this is testable without freezing the clock.
 */
export function formatRelativeTime(value: DateInput, now: DateInput = new Date()): string {
  const date = toDate(value);
  const reference = toDate(now) ?? new Date();
  if (date === undefined) return em();

  const deltaMs = date.getTime() - reference.getTime();
  const future = deltaMs > 0;
  const magnitude = Math.abs(deltaMs);

  if (magnitude < 45 * 1000) return 'just now';

  const phrase = (count: number, unit: string): string => {
    const body = `${count} ${count === 1 ? unit : pluralise(unit)}`;
    return future ? `in ${body}` : `${body} ago`;
  };

  if (magnitude < HOUR) return phrase(Math.round(magnitude / MINUTE), 'minute');
  if (magnitude < DAY) return phrase(Math.round(magnitude / HOUR), 'hour');
  if (magnitude < WEEK) return phrase(Math.round(magnitude / DAY), 'day');
  if (magnitude < 5 * WEEK) return phrase(Math.round(magnitude / WEEK), 'week');
  // The original value, not `date`: a calendar date handed on as a `Date` would lose
  // its date-only nature and be shifted into the reader's zone.
  return formatDate(value);
}

/**
 * `7h 30m`, `45m`, `2d 4h`.
 *
 * @param minutes worked minutes, as attendance and timesheets store them. Decimal
 * hours are never shown to a user: "7.5 hours" invites the reading "7 hours 50".
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return em();
  const total = Math.round(Math.abs(minutes));
  if (total === 0) return `0m`;

  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const mins = total % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  // Minutes are dropped once days are in play — "2d 4h 13m" is false precision.
  if (mins > 0 && days === 0) parts.push(`${mins}m`);

  const body = parts.join(NBSP);
  return minutes < 0 ? `${MINUS}${body}` : body;
}

/** Year, month and day as read in the zone the value will be rendered in. */
interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Reads the calendar parts of a resolved value in its own rendering zone.
 *
 * Comparing the two ends of a range with `getUTCMonth` compares the wrong calendar
 * for an instant: 23:30 on 31 August in Kolkata is still August there and already
 * September in UTC, so the range would collapse the wrong month. Reading through the
 * same formatter that renders the value keeps the comparison and the output in step.
 */
function calendarParts(resolved: ResolvedDate): CalendarParts {
  const formatter = dateFormatter(
    { year: 'numeric', month: '2-digit', day: '2-digit' },
    zoneFor(resolved),
  );
  try {
    const parts = formatter?.formatToParts(resolved.date);
    if (parts !== undefined) {
      const read = (type: string): number =>
        Number.parseInt(parts.find((part) => part.type === type)?.value ?? '', 10);
      const year = read('year');
      const month = read('month');
      const day = read('day');
      // A non-Latin numbering system parses as NaN; fall through to the UTC reading.
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        return { year, month, day };
      }
    }
  } catch {
    // No `formatToParts` on this runtime.
  }
  return {
    year: resolved.date.getUTCFullYear(),
    month: resolved.date.getUTCMonth() + 1,
    day: resolved.date.getUTCDate(),
  };
}

/**
 * `1 – 31 Aug 2026`, collapsing whatever the two ends share.
 *
 * Both ends keep their own calendar/instant nature, so a range of two Postgres
 * `date` values reads the same in Auckland and in Los Angeles, while a range of two
 * timestamps is converted into the reader's zone as it should be.
 */
export function formatDateRange(from: DateInput, to: DateInput): string {
  const start = resolveDate(from);
  const end = resolveDate(to);
  if (start === undefined || end === undefined) return em();

  const left = calendarParts(start);
  const right = calendarParts(end);
  const sameYear = left.year === right.year;
  const sameMonth = sameYear && left.month === right.month;

  // One day is a date, not a range from itself to itself.
  if (sameMonth && left.day === right.day) return renderDate(end, FULL_DATE);

  const head = sameMonth
    ? renderDate(start, { day: 'numeric' })
    : renderDate(start, sameYear ? { day: 'numeric', month: 'short' } : FULL_DATE);
  return `${head}${NBSP}–${NBSP}${renderDate(end, FULL_DATE)}`;
}

// --- Words -----------------------------------------------------------------

/**
 * Naive English pluralisation.
 *
 * Deliberately naive: it covers the unit nouns this product actually uses (item,
 * box, entry, day, hour). Anything irregular is passed explicitly by the caller —
 * a full inflection library for `formatQuantity(2, 'person', 'people')` would be
 * weight without benefit. When the app is localised this is replaced wholesale.
 */
export function pluralise(word: string, count?: number): string {
  if (count !== undefined && Math.abs(count) === 1) return word;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** `2 items`, `1 item`. The count and its noun, agreeing. */
export function countLabel(count: number, singular: string, plural?: string): string {
  const noun = Math.abs(count) === 1 ? singular : (plural ?? pluralise(singular));
  return `${formatNumber(count)} ${noun}`;
}

/**
 * `Asha, Ravi and Meera`, or `Asha, Ravi and 4 others` past the limit.
 *
 * Hand-rolled because Hermes has no `Intl.ListFormat`, and because the overflow
 * behaviour — a count rather than an ellipsis — is a product decision.
 */
export function formatList(items: readonly string[], max = 3): string {
  const present = items.filter((item) => item.trim() !== '');
  if (present.length === 0) return em();
  if (present.length === 1) return present[0] as string;

  if (present.length > max) {
    const shown = present.slice(0, max).join(', ');
    const rest = present.length - max;
    return `${shown} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
  }
  const head = present.slice(0, -1).join(', ');
  return `${head} and ${present[present.length - 1] as string}`;
}

/** Trims to `max` characters on a word boundary, with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  const body = lastSpace > max * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}

/**
 * `payroll_run` → `Payroll run`.
 *
 * Enum values reach the UI as snake case. This renders a fallback label; a
 * user-facing enum that matters gets a real copy map instead of this.
 */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').trim();
  if (spaced === '') return em();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** `ORD-000123`. A stable, sortable, human-quotable reference. */
export function formatReference(prefix: string, sequence: number, width = 6): string {
  const digits = Math.max(0, Math.trunc(sequence)).toString().padStart(width, '0');
  return `${prefix.toUpperCase()}-${digits}`;
}

// --- Internals -------------------------------------------------------------

/**
 * The placeholder for "no value".
 *
 * An em dash, never `0` and never an empty cell: a zero is a measurement and an
 * empty cell reads as a rendering bug. Missing data must look missing.
 */
function em(): string {
  return '—';
}

/** Exposed so tables and detail rows show the same thing for an absent value. */
export const EMPTY_VALUE = '—';

function applySign(body: string, value: number, signed: boolean): string {
  if (value < 0) return `${MINUS}${body}`;
  if (signed && value > 0) return `+${body}`;
  return body;
}

/**
 * Grouping fallback for the no-Intl case. Groups in threes, which is wrong for
 * `en-IN` lakhs — but this path only runs when `Intl.NumberFormat` itself is
 * unavailable, where a readable approximation beats an ungrouped digit string.
 */
function groupDigits(fixed: string): string {
  const [whole = '', fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
