import { describe, expect, it } from 'vitest';
import { invalidationKeys, parseEnvelope, parseSse } from './sse';

describe('parseSse', () => {
  it('parses complete messages and keeps the unfinished tail', () => {
    const chunk = 'id: 1\nevent: invoice.issued\ndata: {"a":1}\n\n: heartbeat\n\nevent: draft.updated\ndata: {"b"';
    const { messages, rest } = parseSse(chunk);
    expect(messages).toEqual([{ id: '1', type: 'invoice.issued', data: '{"a":1}' }]);
    expect(rest).toBe('event: draft.updated\ndata: {"b"');
    const next = parseSse(rest + ':2}\n\n');
    expect(next.messages).toEqual([{ id: undefined, type: 'draft.updated', data: '{"b":2}' }]);
    expect(next.rest).toBe('');
  });

  it('defaults the type to message and joins multi-line data', () => {
    const { messages } = parseSse('data: one\ndata: two\n\n');
    expect(messages).toEqual([{ type: 'message', data: 'one\ntwo', id: undefined }]);
  });

  it('accepts CRLF line endings', () => {
    const { messages } = parseSse('event: ping\r\ndata: {}\r\n\r\n');
    expect(messages).toEqual([{ type: 'ping', data: '{}', id: undefined }]);
  });
});

describe('invalidationKeys', () => {
  it('invalidates invoice lists and the matching draft', () => {
    expect(invalidationKeys('draft.updated', { invoiceId: 'abc' })).toEqual([['invoices'], ['invoice', 'abc']]);
    expect(invalidationKeys('invoice.issued', {})).toEqual([['invoices'], ['invoice']]);
    expect(invalidationKeys('payment.created', {})).toEqual([['invoices'], ['invoice']]);
  });

  it('ignores presence and ping', () => {
    expect(invalidationKeys('presence', { invoiceId: 'x' })).toEqual([]);
    expect(invalidationKeys('ping', {})).toEqual([]);
  });
});

describe('parseEnvelope', () => {
  it('returns null for malformed JSON', () => {
    expect(parseEnvelope('{not json')).toBeNull();
    expect(parseEnvelope('{"type":"presence","data":{}}')?.type).toBe('presence');
  });
});
