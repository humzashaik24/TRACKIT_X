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
}

/** Restores defaults. Used by tests and at sign-out. */
export function resetFormatting(): void {
  config = DEFAULTS;
  numberFormatters.clear();
  dateFormatters.clear();
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

function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | undefined {
  const key = `${config.locale}|${config.timeZone}|${JSON.stringify(options)}`;
  const cached = dateFormatters.get(key);
  if (cached !== undefined) return cached;
  try {
    const created = new Intl.DateTimeFormat(config.locale, {
      timeZone: config.timeZone,
      ...options,
    });
    dateFormatters.set(key, created);
    return created;
  } catch {
    return undefined;
  }
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

/**
 * Parses typed text into integer minor units.
 *
 * Done by string surgery, not `parseFloat(text) * 100`: the multiply reintroduces
 * exactly the float error the minor-unit representation exists to avoid (`19.99 *
 * 100` is `1998.9999999999998`). Returns `undefined` for anything unparseable so
 * a form can show a validation message instead of storing a zero.
 */
export function parseMoneyToMinorUnits(text: string, currency?: string): number | undefined {
  const exponent = minorUnitExponent(currency ?? config.currency);
  // Strip grouping, currency symbols and spaces; keep sign, digits, one separator.
  const cleaned = text
    .trim()
    .replace(/[\s ]/g, '')
    .replace(/[^\d.,\-−+]/g, '')
    .replace(/−/g, '-');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return undefined;

  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');

  // The last separator is the decimal point; earlier ones are grouping. This
  // handles both `1,234.56` and `1.234,56` without needing to know the locale.
  const lastDot = unsigned.lastIndexOf('.');
  const lastComma = unsigned.lastIndexOf(',');
  const decimalAt = Math.max(lastDot, lastComma);
  const separatorIsDecimal = decimalAt !== -1 && unsigned.length - decimalAt - 1 <= exponent;

  const whole = (separatorIsDecimal ? unsigned.slice(0, decimalAt) : unsigned).replace(/[.,]/g, '');
  const fraction = separatorIsDecimal ? unsigned.slice(decimalAt + 1).replace(/[.,]/g, '') : '';
  if (whole === '' && fraction === '') return undefined;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return undefined;

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

/**
 * Coerces the shapes a date arrives in.
 *
 * Postgres `timestamptz` comes back as an ISO string, `date` as `YYYY-MM-DD`. A
 * bare date is anchored at midnight UTC so it does not shift a day backwards for
 * a viewer west of the meridian.
 */
function toDate(value: Date | string | number | null | undefined): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? undefined : fromNumber;
  }
  const text = value.trim();
  if (text === '') return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(dateOnly ? `${text}T00:00:00Z` : text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export type DateInput = Date | string | number | null | undefined;

function withFormatter(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  if (date === undefined) return em();
  const formatter = dateFormatter(options);
  return formatter?.format(date) ?? date.toISOString().slice(0, 10);
}

/** `23 Aug 2026` — unambiguous across locales, unlike any all-numeric form. */
export function formatDate(value: DateInput): string {
  return withFormatter(value, { day: '2-digit', month: 'short', year: 'numeric' });
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
  return formatDate(date);
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

/** `1 Aug – 31 Aug 2026`, collapsing whatever the two ends share. */
export function formatDateRange(from: DateInput, to: DateInput): string {
  const start = toDate(from);
  const end = toDate(to);
  if (start === undefined || end === undefined) return em();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const left = sameMonth
    ? withFormatter(start, { day: 'numeric' })
    : withFormatter(start, sameYear ? { day: 'numeric', month: 'short' } : {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
  return `${left}${NBSP}–${NBSP}${formatDate(end)}`;
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
