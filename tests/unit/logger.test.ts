/**
 * Structured logging.
 *
 * The assertion that matters most: redaction is not opt-in. A caller that logs a
 * whole request object, or a bound context carrying a token, still cannot get a
 * secret into a sink.
 */
import { configureLogger, logger, resetLogger, type LogRecord } from '@/utils/logger';
import { REDACTED } from '@/utils/redact';

let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
  configureLogger({
    level: 'debug',
    sink: (record) => {
      records.push(record);
    },
  });
});

afterEach(() => {
  resetLogger();
});

describe('levels', () => {
  it('emits at and above the configured level', () => {
    configureLogger({ level: 'warn' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(records.map((record) => record.level)).toEqual(['warn', 'error']);
  });

  it('emits nothing when silenced', () => {
    configureLogger({ level: 'silent' });
    logger.error('even this');
    expect(records).toHaveLength(0);
  });

  it('defaults to info after a reset, so a misconfigured deploy is not chatty', () => {
    const captured: LogRecord[] = [];
    resetLogger();
    configureLogger({
      sink: (record) => {
        captured.push(record);
      },
    });
    logger.debug('hidden');
    logger.info('shown');
    expect(captured.map((record) => record.message)).toEqual(['shown']);
  });
});

describe('records', () => {
  it('carries a level, an ISO timestamp, the message and fields', () => {
    logger.info('payroll run finalised', { runId: 'PR-2026-08', employees: 12 });
    const record = records[0];
    expect(record?.level).toBe('info');
    expect(record?.message).toBe('payroll run finalised');
    expect(record?.fields).toEqual({ runId: 'PR-2026-08', employees: 12 });
    expect(record?.time).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('attaches a normalised cause to an error record', () => {
    logger.error('stock movement rejected', new Error('insufficient stock'), { itemId: 'i1' });
    const fields = records[0]?.fields as { itemId: string; cause: { name: string; message: string } };
    expect(fields.itemId).toBe('i1');
    expect(fields.cause.name).toBe('Error');
    expect(fields.cause.message).toBe('insufficient stock');
  });

  it('omits the cause key entirely when there is none', () => {
    logger.error('plain failure');
    expect(Object.keys(records[0]?.fields ?? {})).not.toContain('cause');
  });
});

describe('bound context', () => {
  it('merges child bindings into every record', () => {
    const scoped = logger.child({ correlationId: 'req_1' }).child({ module: 'payroll' });
    scoped.info('calculating');
    expect(records[0]?.fields).toEqual({ correlationId: 'req_1', module: 'payroll' });
  });

  it('lets call-site fields override a binding', () => {
    logger.child({ attempt: 1 }).warn('retrying', { attempt: 2 });
    expect(records[0]?.fields).toEqual({ attempt: 2 });
  });

  it('does not leak bindings from one child to a sibling', () => {
    const base = logger.child({ module: 'inventory' });
    base.child({ itemId: 'a' }).info('one');
    base.child({ itemId: 'b' }).info('two');
    expect(records[0]?.fields).toEqual({ module: 'inventory', itemId: 'a' });
    expect(records[1]?.fields).toEqual({ module: 'inventory', itemId: 'b' });
  });
});

describe('redaction is not optional', () => {
  it('redacts a sensitive field at the call site', () => {
    logger.info('signing in', { email: 'a@b.com', password: 'hunter2' });
    expect(records[0]?.fields).toEqual({ email: 'a@b.com', password: REDACTED });
  });

  it('redacts a secret bound into a child logger', () => {
    logger.child({ accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' }).info('call');
    expect(records[0]?.fields.accessToken).toBe(REDACTED);
  });

  it('redacts a secret hidden inside an innocently named field', () => {
    logger.info('edge function called', {
      body: { model: 'gemini', key: 'AIzaSyD-1234567890abcdefghijklmnopqrst' },
    });
    const body = records[0]?.fields.body as Record<string, unknown>;
    expect(body.key).toBe(REDACTED);
    expect(body.model).toBe('gemini');
  });

  it('leaves ordinary business data alone — over-redaction makes logs useless', () => {
    logger.info('shipment', {
      shippingAddress: '12 Mill Road',
      authorName: 'A. Patel',
      quantity: 40,
      unitCost: 12.5,
    });
    expect(records[0]?.fields).toEqual({
      shippingAddress: '12 Mill Road',
      authorName: 'A. Patel',
      quantity: 40,
      unitCost: 12.5,
    });
  });
});
