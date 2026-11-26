import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Decimal } from '@ddinvoice/domain';
import {
  createCustomer,
  createDraftInvoice,
  createTenant,
  http,
  invoiceLine,
  issueInvoice,
  makePeriodLocked,
  skipDb,
  type Tenant,
} from './helpers';

const d = describe.skipIf(skipDb);

d('invoices', () => {
  let t: Tenant;
  let customerId: string;

  beforeAll(async () => {
    t = await createTenant();
    customerId = await createCustomer(t);
  });
  afterAll(async () => t?.close());

  it('draft → issue allocates a number, posts a balanced journal, stores a snapshot and queues outbox work', async () => {
    const draft = await http(t).post('/invoices', { customerId, lines: [invoiceLine(t)] });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('DRAFT');
    expect(new Decimal(draft.body.total).eq('210')).toBe(true);

    const issued = await issueInvoice(t, draft.body.id);
    expect(issued.status).toBe(201);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.number).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(issued.body.snapshotId).toBeTruthy();

    const journal = await t.prisma.journal.findFirstOrThrow({
      where: { companyId: t.companyId, source: 'INVOICE', sourceId: draft.body.id },
      include: { lines: true },
    });
    const debit = journal.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const credit = journal.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(debit.eq(credit)).toBe(true);
    expect(debit.eq('210')).toBe(true);
    expect(journal.lines.some((l) => l.accountId === t.accounts.ar && new Decimal(l.debit.toString()).eq('210'))).toBe(true);

    const snap = await t.prisma.issueSnapshot.findFirstOrThrow({ where: { companyId: t.companyId, docType: 'INVOICE', docId: draft.body.id } });
    expect(snap.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.id).toBe(issued.body.snapshotId);

    const outbox = await t.prisma.outbox.findMany({ where: { companyId: t.companyId, topic: 'document.render' } });
    expect(outbox.some((o) => (o.payload as { docId?: string }).docId === draft.body.id)).toBe(true);
  });

  it('issued invoices are immutable: edit and delete are refused', async () => {
    const { id, version } = await createDraftInvoice(t, customerId);
    expect((await issueInvoice(t, id)).status).toBe(201);
    const edit = await http(t).patch(`/invoices/${id}`, { notes: 'changed' }, version);
    expect(edit.status).toBe(422);
    expect(edit.body.code).toBe('IMMUTABLE_RECORD');
    const del = await http(t).delete(`/invoices/${id}`);
    expect(del.status).toBe(422);
  });

  it('PATCH on a draft honours If-Match and rejects a stale version', async () => {
    const { id, version } = await createDraftInvoice(t, customerId);
    const stale = await http(t).patch(`/invoices/${id}`, { notes: 'x' }, version + 5);
    expect(stale.status).toBe(412);
    const ok = await http(t).patch(`/invoices/${id}`, { notes: 'updated', lines: [invoiceLine(t, '1', '50')] }, version);
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(version + 1);
    expect(new Decimal(ok.body.total).eq('52.5')).toBe(true);
  });

  it('20 parallel issues on 20 drafts get 20 unique consecutive numbers', async () => {
    const drafts: string[] = [];
    for (let i = 0; i < 20; i++) drafts.push((await createDraftInvoice(t, customerId)).id);
    const results = await Promise.all(drafts.map((id) => issueInvoice(t, id)));
    for (const r of results) expect(r.status).toBe(201);
    const seqs = results.map((r) => Number(String(r.body.number).split('-')[2]));
    expect(new Set(seqs).size).toBe(20);
    expect(Math.max(...seqs) - Math.min(...seqs)).toBe(19);
  }, 60_000);

  it('the same Idempotency-Key twice creates one invoice and replays the stored response', async () => {
    const key = `idem-${Date.now()}`;
    const body = { customerId, lines: [invoiceLine(t)] };
    const first = await http(t).post('/invoices', body, key);
    const second = await http(t).post('/invoices', body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    const count = await t.prisma.invoice.count({ where: { companyId: t.companyId, id: first.body.id } });
    expect(count).toBe(1);
  });

  it('reusing an Idempotency-Key with a different body is a conflict', async () => {
    const key = `conflict-${Date.now()}`;
    await http(t).post('/invoices', { customerId, lines: [invoiceLine(t, '1')] }, key);
    const res = await http(t).post('/invoices', { customerId, lines: [invoiceLine(t, '9')] }, key);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('issuing inside a locked period fails with PERIOD_LOCKED', async () => {
    const locked = await createTenant();
    try {
      const cust = await createCustomer(locked);
      const { id } = await createDraftInvoice(locked, cust);
      await makePeriodLocked(locked);
      const res = await issueInvoice(locked, id);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PERIOD_LOCKED');
      const still = await locked.prisma.invoice.findFirstOrThrow({ where: { id } });
      expect(still.status).toBe('DRAFT');
    } finally {
      await locked.close();
    }
  });

  it('other companies records are reported as 404, never as forbidden', async () => {
    const other = await createTenant();
    try {
      const otherCustomer = await createCustomer(other);
      const { id } = await createDraftInvoice(other, otherCustomer);
      const read = await http(t).get(`/invoices/${id}`);
      expect(read.status).toBe(404);
      expect(read.body.code).toBe('NOT_FOUND');
      expect((await issueInvoice(t, id)).status).toBe(404);
    } finally {
      await other.close();
    }
  });

  it('list supports status filter and cursor pagination', async () => {
    const page1 = await http(t).get('/invoices?status=ISSUED&limit=5&sort=createdAt&dir=asc');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.items.every((i: { status: string }) => i.status === 'ISSUED')).toBe(true);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await http(t).get(`/invoices?status=ISSUED&limit=5&sort=createdAt&dir=asc&cursor=${page1.body.nextCursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[4].id);
  });
});
