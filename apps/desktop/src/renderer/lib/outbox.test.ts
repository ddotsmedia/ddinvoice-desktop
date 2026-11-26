import { describe, expect, it } from 'vitest';
import { nextDelayMs, Outbox, RetriableError, type OutboxSender, type OutboxStorage } from './outbox';

const memory = (): OutboxStorage & { raw: Map<string, string> } => {
  const raw = new Map<string, string>();
  return { raw, getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => void raw.set(k, v) };
};

const sender = (behaviour: (path: string, key: string) => 'ok' | 'retry' | 'reject', log: string[] = []): OutboxSender => {
  const run = async (path: string, opts: { idempotencyKey: string }) => {
    log.push(`${path}#${opts.idempotencyKey}`);
    const b = behaviour(path, opts.idempotencyKey);
    if (b === 'retry') throw new RetriableError('offline');
    if (b === 'reject') throw new Error('422');
    return {};
  };
  return { post: run, patch: run };
};

describe('Outbox', () => {
  it('keeps the same Idempotency-Key from enqueue to resend', async () => {
    const store = memory();
    const box = new Outbox(store);
    box.enqueue({ method: 'POST', path: '/invoices/1/issue', idempotencyKey: 'key-1' });
    const log: string[] = [];
    let online = false;
    const s = sender(() => (online ? 'ok' : 'retry'), log);
    expect((await box.flush(s)).remaining).toBe(1);
    online = true;
    const result = await box.flush(s);
    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(log).toEqual(['/invoices/1/issue#key-1', '/invoices/1/issue#key-1']);
  });

  it('does not queue the same command twice', () => {
    const box = new Outbox(memory());
    box.enqueue({ method: 'POST', path: '/p', idempotencyKey: 'k' });
    box.enqueue({ method: 'POST', path: '/p', idempotencyKey: 'k' });
    expect(box.list()).toHaveLength(1);
  });

  it('stops at the first retriable failure so later commands do not overtake it', async () => {
    const box = new Outbox(memory());
    box.enqueue({ method: 'PATCH', path: '/invoices/a', idempotencyKey: 'a', ifMatch: 1, body: {} });
    box.enqueue({ method: 'POST', path: '/invoices/b/issue', idempotencyKey: 'b' });
    const log: string[] = [];
    const result = await box.flush(sender(() => 'retry', log));
    expect(log).toEqual(['/invoices/a#a']);
    expect(result.remaining).toBe(2);
    expect(box.list()[0]!.attempts).toBe(1);
  });

  it('drops commands the server rejects', async () => {
    const box = new Outbox(memory());
    box.enqueue({ method: 'POST', path: '/invoices/a/issue', idempotencyKey: 'a' });
    const result = await box.flush(sender(() => 'reject'));
    expect(result).toEqual({ sent: 0, remaining: 0 });
  });

  it('tolerates corrupt storage', () => {
    const store = memory();
    store.setItem('ddi.outbox.v1', '{not json');
    expect(new Outbox(store).list()).toEqual([]);
  });
});

describe('nextDelayMs', () => {
  it('doubles and caps at 30 s', () => {
    expect([0, 1, 2, 3].map(nextDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(nextDelayMs(20)).toBe(30_000);
  });
});
