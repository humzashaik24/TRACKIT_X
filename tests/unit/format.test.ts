/**
 * Presentation formatting.
 *
 * The load-bearing assertion is the money round trip: text typed into a form must
 * survive `parse → store → format` with no drift. Everything else here guards a
 * specific way a formatter reads wrong to a person — a zero standing in for
 * missing data, a hyphen standing in for a minus, decimal hours read as minutes.
 *
 * All date assertions pin an explicit time zone. A test that formats "today" in
 * the machine's zone passes in one office and fails in another.
 */
import {
  EMPTY_VALUE,
  configureFormatting,
  countLabel,
  formatCompactNumber,
  formatDate,
  formatDateLong,
  formatDateRange,
  formatDateShort,
  formatDateTime,
  formatDelta,
  formatDuration,
  formatFileSize,
  formatList,
  formatMoney,
  formatMoneyCompact,
  formatMonth,
  formatNumber,
  formatPercent,
  formatPercentagePoints,
  formatQuantity,
  formatReference,
  formatRelativeTime,
  formattingConfig,
  humanise,
  minorUnitExponent,
  parseMoneyToMinorUnits,
  pluralise,
  resetFormatting,
  toDateKey,
  toMajorUnits,
  truncate,
} from '@/utils/format';

const MINUS = '−';

beforeEach(() => {
  resetFormatting();
});

afterEach(() => {
  resetFormatting();
});

/** Strips the currency symbol so assertions test grouping, not glyph choice. */
function digitsOf(text: string): string {
  return text.replace(/[^\d.,]/g, '');
}

describe('configuration', () => {
  it('defaults to the organization profile a first-run MSME expects', () => {
    expect(formattingConfig()).toEqual({
      locale: 'en-IN',
      currency: 'INR',
      timeZone: 'Asia/Kolkata',
    });
  });

  it('takes the organization settings and applies them to output', () => {
    const before = formatMoney(150_000_00);
    configureFormatting({ locale: 'en-US', currency: 'USD' });
    const after = formatMoney(150_000_00);
    // Both the symbol and the grouping change, so the formatter cache was cleared.
    expect(after).not.toBe(before);
    expect(after).toContain('150,000.00');
  });

  it('merges a partial update instead of replacing the whole config', () => {
    configureFormatting({ currency: 'USD' });
    expect(formattingConfig().locale).toBe('en-IN');
    expect(formattingConfig().currency).toBe('USD');
  });
});

describe('minor units', () => {
  it('knows the currencies that are not two decimal places', () => {
    expect(minorUnitExponent('INR')).toBe(2);
    expect(minorUnitExponent('usd')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
  });

  it('assumes two places for an unlisted code rather than throwing', () => {
    expect(minorUnitExponent('XYZ')).toBe(2);
  });

  it('scales by the currency, not by a hardcoded hundred', () => {
    expect(toMajorUnits(123_456, 'INR')).toBe(1234.56);
    // ¥1,000 is stored as 1000, not 100000 — dividing by 100 would show ¥10.
    expect(toMajorUnits(1000, 'JPY')).toBe(1000);
    expect(toMajorUnits(1_500, 'KWD')).toBe(1.5);
  });
});

describe('formatMoney', () => {
  it('renders stored paise as rupees', () => {
    expect(digitsOf(formatMoney(1_250_00))).toBe('1,25,000.00');
  });

  it('keeps both decimal places, because a payslip is reconciled', () => {
    expect(formatMoney(1)).toContain('0.01');
    expect(formatMoney(99)).toContain('0.99');
    expect(formatMoney(100)).toContain('1.00');
  });

  it('drops decimals only when explicitly asked', () => {
    expect(formatMoney(1_234_56, { whole: true })).not.toContain('.');
  });

  it('uses a real minus sign for a negative amount', () => {
    const negative = formatMoney(-45_000);
    expect(negative.startsWith(MINUS)).toBe(true);
    expect(negative).not.toContain('-');
  });

  it('shows a plus only when the sign carries meaning', () => {
    expect(formatMoney(500, { signed: true }).startsWith('+')).toBe(true);
    expect(formatMoney(500).startsWith('+')).toBe(false);
    // Zero is neither a credit nor a debit.
    expect(formatMoney(0, { signed: true }).startsWith('+')).toBe(false);
  });

  it('renders the code when a symbol would be ambiguous', () => {
    expect(formatMoney(100_00, { currency: 'USD', display: 'code' })).toContain('USD');
  });

  it('omits currency entirely on request, for a column with a header', () => {
    const bare = formatMoney(100_00, { display: 'none' });
    expect(bare).toBe('10,000.00');
  });

  it('respects a per-call currency without changing global config', () => {
    expect(formatMoney(1000, { currency: 'JPY' })).toContain('1,000');
    expect(formattingConfig().currency).toBe('INR');
  });

  it('rounds a fractional minor unit rather than inventing precision', () => {
    // A stray float from a caller must not render as ₹0.014.
    expect(formatMoney(1.4)).toBe(formatMoney(1));
    expect(formatMoney(1.6)).toBe(formatMoney(2));
  });

  it('shows a missing amount as missing, never as zero', () => {
    // A blank cell reads as a bug and a zero reads as a measurement. Neither is
    // what "we do not have this figure" means.
    expect(formatMoney(Number.NaN)).toBe(EMPTY_VALUE);
    expect(formatMoney(0)).not.toBe(EMPTY_VALUE);
  });
});

describe('formatMoneyCompact', () => {
  it('shortens a large figure', () => {
    const compact = formatMoneyCompact(50_00_00_000_00);
    expect(compact.length).toBeLessThan(formatMoney(50_00_00_000_00).length);
  });

  it('still signs a negative', () => {
    expect(formatMoneyCompact(-50_00_000_00).startsWith(MINUS)).toBe(true);
  });
});

describe('parseMoneyToMinorUnits', () => {
  it('parses plain input', () => {
    expect(parseMoneyToMinorUnits('1200')).toBe(120_000);
    expect(parseMoneyToMinorUnits('1200.50')).toBe(120_050);
    expect(parseMoneyToMinorUnits('0.05')).toBe(5);
  });

  it('parses without float multiplication error', () => {
    // `parseFloat('19.99') * 100` is 1998.9999999999998. This is the whole reason
    // the parse is done on the string.
    expect(parseMoneyToMinorUnits('19.99')).toBe(1999);
    expect(parseMoneyToMinorUnits('0.29')).toBe(29);
    expect(parseMoneyToMinorUnits('1.005')).toBe(100);
    expect(Number.isInteger(parseMoneyToMinorUnits('8.11') as number)).toBe(true);
  });

  it('round-trips through the formatter', () => {
    for (const typed of ['1200.50', '0.01', '99999.99', '7', '0.99']) {
      const stored = parseMoneyToMinorUnits(typed);
      expect(stored).toBeDefined();
      const shown = formatMoney(stored as number, { display: 'none' });
      expect(parseMoneyToMinorUnits(shown)).toBe(stored);
    }
  });

  it('ignores grouping separators and currency decoration', () => {
    expect(parseMoneyToMinorUnits('₹1,25,000.00')).toBe(125_000_00);
    expect(parseMoneyToMinorUnits('  1 200,50  ')).toBe(120_050);
    expect(parseMoneyToMinorUnits('INR 45.00')).toBe(4500);
  });

  it('handles a locale that groups with dots', () => {
    // `1.234,56` is one thousand two hundred thirty-four and fifty-six, not 1.23.
    expect(parseMoneyToMinorUnits('1.234,56')).toBe(123_456);
  });

  it('reads a minus in either glyph', () => {
    expect(parseMoneyToMinorUnits('-45.00')).toBe(-4500);
    expect(parseMoneyToMinorUnits('−45.00')).toBe(-4500);
  });

  it('scales to the currency, not always by a hundred', () => {
    expect(parseMoneyToMinorUnits('1000', 'JPY')).toBe(1000);
    expect(parseMoneyToMinorUnits('1.500', 'KWD')).toBe(1500);
  });

  it('returns undefined rather than zero for unusable input', () => {
    // Storing a zero for "abc" would silently record an amount the user never
    // entered. The form needs to be able to tell the difference.
    expect(parseMoneyToMinorUnits('')).toBeUndefined();
    expect(parseMoneyToMinorUnits('   ')).toBeUndefined();
    expect(parseMoneyToMinorUnits('abc')).toBeUndefined();
    expect(parseMoneyToMinorUnits('-')).toBeUndefined();
    expect(parseMoneyToMinorUnits('₹')).toBeUndefined();
  });

  it('refuses an amount too large to hold exactly', () => {
    expect(parseMoneyToMinorUnits('99999999999999999999')).toBeUndefined();
  });
});

describe('formatNumber', () => {
  it('groups and trims', () => {
    expect(digitsOf(formatNumber(1234567))).toBe('12,34,567');
    expect(formatNumber(12.5)).toBe('12.5');
    expect(formatNumber(12)).toBe('12');
  });

  it('honours a fixed precision', () => {
    expect(formatNumber(12, { decimals: 2 })).toBe('12.00');
    expect(formatNumber(12.345, { decimals: 1 })).toBe('12.3');
  });

  it('signs with a minus, not a hyphen', () => {
    expect(formatNumber(-40)).toBe(`${MINUS}40`);
  });

  it('shortens for a tick label', () => {
    expect(formatCompactNumber(1500).length).toBeLessThan(formatNumber(1500).length);
  });

  it('reports a broken number as missing', () => {
    expect(formatNumber(Number.NaN)).toBe(EMPTY_VALUE);
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe(EMPTY_VALUE);
  });
});

describe('percentages', () => {
  it('takes a ratio, not a percentage', () => {
    expect(formatPercent(0.084)).toBe('8.4%');
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('keeps percent and percentage points distinct', () => {
    // Margin 20% → 23% rose three points. Calling that "3%" is the classic error;
    // the two functions exist so a caller has to choose.
    expect(formatPercent(0.03)).toBe('3.0%');
    expect(formatPercentagePoints(3)).toBe('+3.0 pp');
  });

  it('signs points by default, because a point change is always a comparison', () => {
    expect(formatPercentagePoints(-2.5)).toBe(`${MINUS}2.5 pp`);
    expect(formatPercentagePoints(2.5, { signed: false })).toBe('2.5 pp');
  });

  it('controls precision', () => {
    expect(formatPercent(0.08456, { decimals: 2 })).toBe('8.46%');
    expect(formatPercent(0.08456, { decimals: 0 })).toBe('8%');
  });
});

describe('formatDelta', () => {
  it('signs a movement', () => {
    expect(formatDelta(12.4)).toBe('+12.4');
    expect(formatDelta(-3)).toBe(`${MINUS}3`);
  });

  it('leaves no movement unsigned', () => {
    // `+0` claims an increase that did not happen.
    expect(formatDelta(0)).toBe('0');
  });
});

describe('formatQuantity and countLabel', () => {
  it('agrees the noun with the count', () => {
    expect(formatQuantity(1, 'unit')).toBe('1 unit');
    expect(formatQuantity(40, 'unit')).toBe('40 units');
    expect(formatQuantity(0, 'unit')).toBe('0 units');
  });

  it('takes an explicit plural for an irregular noun', () => {
    expect(formatQuantity(3, 'person', 'people')).toBe('3 people');
    expect(countLabel(1, 'person', 'people')).toBe('1 person');
  });

  it('treats a negative one as singular', () => {
    expect(formatQuantity(-1, 'unit')).toBe(`${MINUS}1 unit`);
  });
});

describe('formatFileSize', () => {
  it('steps through the units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatFileSize(1024 ** 4)).toBe('1.0 TB');
  });

  it('drops the decimal once the figure is large enough not to need it', () => {
    expect(formatFileSize(45 * 1024 * 1024)).toBe('45 MB');
  });

  it('rejects a negative size', () => {
    expect(formatFileSize(-1)).toBe(EMPTY_VALUE);
  });
});

describe('dates', () => {
  // A fixed instant, so nothing here depends on when the suite runs.
  const instant = '2026-08-23T09:30:00.000Z';

  beforeEach(() => {
    configureFormatting({ locale: 'en-GB', timeZone: 'UTC' });
  });

  it('spells the month, so a date is never ambiguous', () => {
    // 03/08/2026 is two different days depending on the reader. This is not.
    const formatted = formatDate(instant);
    expect(formatted).toContain('Aug');
    expect(formatted).toContain('2026');
    expect(formatted).toContain('23');
  });

  it('accepts the shapes Postgres returns', () => {
    expect(formatDate('2026-08-23')).toBe(formatDate(new Date(instant)));
    expect(formatDate(Date.parse(instant))).toContain('Aug');
  });

  it('anchors a bare date at UTC so it does not slip a day', () => {
    // `new Date('2026-08-23')` is midnight UTC; formatting it in a western zone
    // without anchoring would render 22 Aug.
    configureFormatting({ timeZone: 'America/New_York' });
    expect(formatDate('2026-08-23')).toContain('23');
  });

  it('renders the shorter and longer forms', () => {
    expect(formatDateShort(instant)).not.toContain('2026');
    expect(formatDateLong(instant)).toContain('Sunday');
    expect(formatMonth(instant)).toBe('Aug 2026');
  });

  it('renders a time and a timestamp in the configured zone', () => {
    expect(formatTimeDigits(formatDateTime(instant))).toContain('09:30');
    configureFormatting({ timeZone: 'Asia/Kolkata' });
    // 09:30 UTC is 15:00 IST — the zone is applied, not ignored.
    expect(formatTimeDigits(formatDateTime(instant))).toContain('15:00');
  });

  it('emits the key a date column expects, never a localised string', () => {
    expect(toDateKey(instant)).toBe('2026-08-23');
    expect(toDateKey('2026-08-23')).toBe('2026-08-23');
    expect(toDateKey('nonsense')).toBeUndefined();
  });

  it('collapses what a range shares', () => {
    const sameMonth = formatDateRange('2026-08-01', '2026-08-31');
    // The month is stated once, on the end.
    expect(sameMonth.match(/Aug/g)).toHaveLength(1);

    const crossYear = formatDateRange('2025-12-28', '2026-01-03');
    expect(crossYear).toContain('2025');
    expect(crossYear).toContain('2026');
  });

  it('shows a missing or unparseable date as missing', () => {
    expect(formatDate(null)).toBe(EMPTY_VALUE);
    expect(formatDate(undefined)).toBe(EMPTY_VALUE);
    expect(formatDate('')).toBe(EMPTY_VALUE);
    expect(formatDate('not a date')).toBe(EMPTY_VALUE);
    expect(formatDate(new Date('nope'))).toBe(EMPTY_VALUE);
    expect(formatDateRange(null, '2026-08-31')).toBe(EMPTY_VALUE);
  });
});

/** Keeps the time assertions independent of separator and space characters. */
function formatTimeDigits(text: string): string {
  return text.replace(/[  ]/g, ' ');
}

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  const ahead = (ms: number): Date => new Date(now.getTime() + ms);

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('says just now inside the noise window', () => {
    expect(formatRelativeTime(ago(5_000), now)).toBe('just now');
    expect(formatRelativeTime(ahead(5_000), now)).toBe('just now');
  });

  it('counts backwards in the past', () => {
    expect(formatRelativeTime(ago(12 * MINUTE), now)).toBe('12 minutes ago');
    expect(formatRelativeTime(ago(1 * MINUTE), now)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(3 * HOUR), now)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe('2 days ago');
    expect(formatRelativeTime(ago(9 * DAY), now)).toBe('1 week ago');
  });

  it('counts forwards for a due date', () => {
    expect(formatRelativeTime(ahead(3 * DAY), now)).toBe('in 3 days');
    expect(formatRelativeTime(ahead(1 * HOUR), now)).toBe('in 1 hour');
  });

  it('gives up on relative wording once it stops being informative', () => {
    // "3 months ago" tells a user less than the date does.
    const old = formatRelativeTime(ago(120 * DAY), now);
    expect(old).not.toContain('ago');
    expect(old).toContain('2026');
  });

  it('reports a missing timestamp as missing', () => {
    expect(formatRelativeTime(null, now)).toBe(EMPTY_VALUE);
  });
});

describe('formatDuration', () => {
  it('reads as hours and minutes, never as decimal hours', () => {
    // "7.5 hours" invites the reading "7 hours 50 minutes".
    expect(formatDuration(450)).toBe('7h 30m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
  });

  it('drops minutes once days are in play', () => {
    expect(formatDuration(3253)).toBe('2d 6h');
  });

  it('shows a zero duration as zero, not as missing', () => {
    // Nobody worked no minutes by accident; zero is a real attendance value.
    expect(formatDuration(0)).toBe('0m');
  });

  it('signs a negative duration', () => {
    expect(formatDuration(-90)).toBe(`${MINUS}1h 30m`);
  });

  it('reports a broken duration as missing', () => {
    expect(formatDuration(Number.NaN)).toBe(EMPTY_VALUE);
  });
});

describe('words', () => {
  it('pluralises the unit nouns the product uses', () => {
    expect(pluralise('item')).toBe('items');
    expect(pluralise('box')).toBe('boxes');
    expect(pluralise('batch')).toBe('batches');
    expect(pluralise('entry')).toBe('entries');
    expect(pluralise('day')).toBe('days');
    expect(pluralise('item', 1)).toBe('item');
  });

  it('joins a list with a count for the overflow', () => {
    expect(formatList(['Asha'])).toBe('Asha');
    expect(formatList(['Asha', 'Ravi'])).toBe('Asha and Ravi');
    expect(formatList(['Asha', 'Ravi', 'Meera'])).toBe('Asha, Ravi and Meera');
    expect(formatList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 others');
    expect(formatList(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 other');
  });

  it('respects a tighter list limit', () => {
    expect(formatList(['A', 'B', 'C'], 2)).toBe('A, B and 1 other');
  });

  it('shows an empty list as missing', () => {
    expect(formatList([])).toBe(EMPTY_VALUE);
    expect(formatList(['', '  '])).toBe(EMPTY_VALUE);
  });

  it('truncates on a word boundary', () => {
    expect(truncate('short', 20)).toBe('short');
    const cut = truncate('Quarterly inventory reconciliation report', 22);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(22);
    expect(cut).not.toContain(' …');
  });

  it('turns an enum value into a label', () => {
    expect(humanise('payroll_run')).toBe('Payroll run');
    expect(humanise('AWAITING_APPROVAL')).toBe('Awaiting approval');
    expect(humanise('stockMovement')).toBe('Stock movement');
    expect(humanise('')).toBe(EMPTY_VALUE);
  });

  it('builds a quotable reference', () => {
    expect(formatReference('ord', 123)).toBe('ORD-000123');
    expect(formatReference('PR', 7, 4)).toBe('PR-0007');
    // Sortable: string order matches numeric order at a fixed width.
    expect(formatReference('ORD', 9) < formatReference('ORD', 10)).toBe(true);
  });
});
