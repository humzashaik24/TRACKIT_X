/**
 * Trackit X — structured logging.
 *
 * Logs are structured records, not sentences. Every entry is an object with a
 * level, a message and typed fields, so a log aggregator can filter by
 * `organizationId` or `correlationId` instead of matching text.
 *
 * Three decisions worth knowing about:
 *
 *  · Everything passed as fields goes through `redact` first. A secret cannot be
 *    logged from here even deliberately, which is the point — see `redact.ts`.
 *  · The logger imports no configuration. It is deliberately usable before the
 *    environment has been validated, because the first thing worth logging in a
 *    broken deployment is the configuration failure itself. The host app calls
 *    `configureLogger` once at startup.
 *  · There is no `fatal`. A failure either has a user-facing consequence, in
 *    which case it is an `error` with an `AppError` attached, or it does not.
 *
 * This is diagnostic logging. It is NOT the audit trail: who changed which
 * record is recorded in the database inside the same transaction as the change,
 * because an audit entry that can be lost when a log ships is not an audit.
 */
import { redactFields } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** Fields attached to a log entry. Redacted before they are emitted. */
export type LogFields = Readonly<Record<string, unknown>>;

export interface LogRecord {
  readonly level: Exclude<LogLevel, 'silent'>;
  readonly time: string;
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

/** Where records go. Swappable so tests can assert on them. */
export type LogSink = (record: LogRecord) => void;

export interface LoggerConfig {
  /** Minimum level emitted. `silent` disables logging entirely. */
  level: LogLevel;
  /** Human-readable multi-value output for a terminal, versus one JSON line. */
  pretty: boolean;
  sink?: LogSink;
}

/**
 * Defaults are conservative: `info` and JSON. A deployment that never calls
 * `configureLogger` therefore behaves like production rather than accidentally
 * emitting debug output.
 */
const config: LoggerConfig = {
  level: 'info',
  pretty: false,
};

let sink: LogSink = defaultSink;

export function configureLogger(next: Partial<LoggerConfig>): void {
  if (next.level !== undefined) config.level = next.level;
  if (next.pretty !== undefined) config.pretty = next.pretty;
  if (next.sink !== undefined) sink = next.sink;
}

/** Restores the built-in console sink and default thresholds. For tests. */
export function resetLogger(): void {
  config.level = 'info';
  config.pretty = false;
  sink = defaultSink;
}

/**
 * The default sink's console bindings.
 *
 * This is the ONE sanctioned place in the codebase that calls `console.log` and
 * `console.info`. `no-console` is on everywhere else precisely so that ad-hoc
 * logging cannot bypass redaction — every record reaching these functions has
 * already been through `redactFields`.
 */
const consoleForLevel: Record<Exclude<LogLevel, 'silent'>, (...args: unknown[]) => void> = {
  // Bound lazily through wrappers so a test that swaps `console` still works.
  debug: (...args) => {
    // eslint-disable-next-line no-console -- the logger's own sink; see above.
    console.log(...args);
  },
  info: (...args) => {
    // eslint-disable-next-line no-console -- the logger's own sink; see above.
    console.info(...args);
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};

function defaultSink(record: LogRecord): void {
  const write = consoleForLevel[record.level];

  if (!config.pretty) {
    // One line of JSON: what a log aggregator can actually parse.
    write(
      JSON.stringify({
        level: record.level,
        time: record.time,
        msg: record.message,
        ...record.fields,
      }),
    );
    return;
  }

  const hasFields = Object.keys(record.fields).length > 0;
  const prefix = `${record.level.toUpperCase().padEnd(5)} ${record.message}`;
  if (hasFields) {
    write(prefix, record.fields);
  } else {
    write(prefix);
  }
}

function shouldEmit(level: Exclude<LogLevel, 'silent'>): boolean {
  return levelRank[level] >= levelRank[config.level];
}

/**
 * A logger with fields bound to every record it emits.
 *
 * Bound context is how a request stays traceable: create a child with a
 * `correlationId` at the boundary and every downstream line carries it without
 * being threaded through call signatures.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** `cause` is normalised and redacted; pass the thrown value directly. */
  error(message: string, cause?: unknown, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

function emit(
  level: Exclude<LogLevel, 'silent'>,
  bindings: LogFields,
  message: string,
  fields: LogFields | undefined,
): void {
  if (!shouldEmit(level)) return;

  sink({
    level,
    // Callers never supply the timestamp; a log entry timed by its author is
    // one more thing that can disagree with reality.
    time: new Date().toISOString(),
    message,
    fields: redactFields({ ...bindings, ...fields }),
  });
}

function createLogger(bindings: LogFields): Logger {
  return {
    debug(message, fields) {
      emit('debug', bindings, message, fields);
    },
    info(message, fields) {
      emit('info', bindings, message, fields);
    },
    warn(message, fields) {
      emit('warn', bindings, message, fields);
    },
    error(message, cause, fields) {
      emit('error', bindings, message, cause === undefined ? fields : { ...fields, cause });
    },
    child(next) {
      return createLogger({ ...bindings, ...next });
    },
  };
}

/** The application logger. Prefer a `child` with bound context in a module. */
export const logger: Logger = createLogger({});
