import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Decimal } from '@ddinvoice/domain';
import { createCustomer, createDraftInvoice, createTenant, http, invoiceLine, issueInvoice, skipDb, type Tenant } from './helpers';

const d = describe.skipIf(skipDb);

const money = (v: unknown) => new Decimal(String(v));

d('credit notes, payments and quotes', () => {
  let t: Tenant;
  let customerId: string;

  beforeAll(async () => {
    t = await createTenant();
    customerId = await createCustomer(t);
  });
  afterAll(async () => t?.close());

  /** Issues a fresh 210.00 invoice for a customer (2 × 100 at 5%). */
  async function issued210(cust = customerId): Promise<string> {
    const { id } = await createDraftInvoice(t, cust);
    const res = await issueInvoice(t, id);
    expect(res.status).toBe(201);
    return id;
  }

  it('a credit note reduces the open balance of its invoice', async () => {
    const invoiceId = await issued210();
    const draft = await http(t).post('/credit-notes', {
      invoiceId,
      reason: 'Price correction',
      lines: [invoiceLine(t, '1', '100')],
    });
    expect(draft.status).toBe(201);
    expect(money(draft.body.total).eq('105')).toBe(true);

    const issue = await http(t).post(`/credit-notes/${draft.body.id}/issue`);
    expect(issue.status).toBe(201);
    expect(issue.body.number).toMatch(/^CN-\d{4}-\d{5}$/);

    const inv = await http(t).get(`/invoices/${invoiceId}`);
    expect(money(inv.body.openBalance).eq('105')).toBe(true);
  });

  it('refuses a credit note larger than the remaining invoice total', async () => {
    const invoiceId = await issued210();
    const draft = await http(t).post('/credit-notes', { invoiceId, reason: 'Too much', lines: [invoiceLine(t, '1', '500')] });
    expect(draft.status).toBe(201);
    const issue = await http(t).post(`/credit-notes/${draft.body.id}/issue`);
    expect(issue.status).toBe(422);
    expect(issue.body.code).toBe('OVER_CREDIT');
  });

  it('partial then full payment moves settlement PARTIAL → PAID', async () => {
    const invoiceId = await issued210(await createCustomer(t));
    const cust = (await t.prisma.invoice.findFirstOrThrow({ where: { id: invoiceId } })).customerId;
    const bank = t.accounts.bank;

    const first = await http(t).post('/payments', {
      customerId: cust,
      date: '2026-11-01',
      method: 'BANK',
      bankAccountId: bank,
      amount: '100.00',
      allocations: [{ invoiceId, amount: '100.00' }],
    });
    expect(first.status).toBe(201);
    expect(money(first.body.unallocated).eq('0')).toBe(true);
    expect((await http(t).get(`/invoices/${invoiceId}`)).body.settlementStatus).toBe('PARTIAL');

    const second = await http(t).post('/payments', {
      customerId: cust,
      date: '2026-11-02',
      method: 'BANK',
      bankAccountId: bank,
      amount: '110.00',
    });
    expect(second.status).toBe(201);
    const allocated = await http(t).post(`/payments/${second.body.id}/allocate`, {});
    expect(allocated.status).toBe(201);
    const inv = await http(t).get(`/invoices/${invoiceId}`);
    expect(inv.body.settlementStatus).toBe('PAID');
    expect(money(inv.body.openBalance).eq('0')).toBe(true);
  });

  it('overpayment leaves the excess as unallocated customer credit', async () => {
    const cust = await createCustomer(t);
    const invoiceId = await issued210(cust);
    const pay = await http(t).post('/payments', {
      customerId: cust,
      date: '2026-11-03',
      method: 'CASH',
      bankAccountId: t.accounts.bank,
      amount: '250.00',
    });
    expect(pay.status).toBe(201);
    const allocated = await http(t).post(`/payments/${pay.body.id}/allocate`, {});
    expect(allocated.status).toBe(201);
    expect(money(allocated.body.unallocated).eq('40')).toBe(true);
    expect(money(allocated.body.allocations[0].amount).eq('210')).toBe(true);
    expect((await http(t).get(`/invoices/${invoiceId}`)).body.settlementStatus).toBe('PAID');
  });

  it('a receipt can be reversed once; the invoice is open again', async () => {
    const cust = await createCustomer(t);
    const invoiceId = await issued210(cust);
    const pay = await http(t).post('/payments', {
      customerId: cust,
      date: '2026-11-04',
      method: 'BANK',
      bankAccountId: t.accounts.bank,
      amount: '210.00',
      allocations: [{ invoiceId, amount: '210.00' }],
    });
    expect(pay.status).toBe(201);
    const rev = await http(t).post(`/payments/${pay.body.id}/reverse`);
    expect(rev.status).toBe(201);
    expect((await http(t).get(`/invoices/${invoiceId}`)).body.settlementStatus).toBe('UNPAID');
    const again = await http(t).post(`/payments/${pay.body.id}/reverse`);
    expect(again.status).toBe(409);
  });

  it('quote → send → accept creates a draft invoice with the same totals', async () => {
    const cust = await createCustomer(t);
    const quote = await http(t).post('/quotes', { customerId: cust, lines: [invoiceLine(t, '2', '100')] });
    expect(quote.status).toBe(201);
    expect(quote.body.status).toBe('DRAFT');

    const sent = await http(t).post(`/quotes/${quote.body.id}/send`);
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('SENT');
    expect(sent.body.number).toMatch(/^QT-\d{4}-\d{5}$/);

    const accepted = await http(t).post(`/quotes/${quote.body.id}/accept`);
    expect(accepted.status).toBe(201);
    expect(accepted.body.quote.status).toBe('ACCEPTED');
    const inv = await http(t).get(`/invoices/${accepted.body.invoiceId}`);
    expect(inv.status).toBe(200);
    expect(inv.body.status).toBe('DRAFT');
    expect(money(inv.body.total).eq(money(quote.body.total))).toBe(true);
    expect(inv.body.lines).toHaveLength(1);
  });

  it('a sent quote can be revised into a new draft revision with the same number', async () => {
    const cust = await createCustomer(t);
    const quote = await http(t).post('/quotes', { customerId: cust, lines: [invoiceLine(t, '1', '10')] });
    const sent = await http(t).post(`/quotes/${quote.body.id}/send`);
    const rev = await http(t).post(`/quotes/${quote.body.id}/revise`);
    expect(rev.status).toBe(201);
    expect(rev.body.revision).toBe(2);
    expect(rev.body.number).toBe(sent.body.number);
    expect(rev.body.status).toBe('DRAFT');
  });
});
