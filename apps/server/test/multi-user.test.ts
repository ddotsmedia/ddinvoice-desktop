import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { EventBus, type LiveEvent } from '../src/events/event-bus';
import { createCustomer, createDraftInvoice, createTenant, DEVICE_ID, http, invoiceLine, issueInvoice, PASSWORD, skipDb, type Tenant } from './helpers';

const d = describe.skipIf(skipDb);

d('multi-user safety', () => {
  let t: Tenant;
  let customerId: string;
  let bus: EventBus;

  beforeAll(async () => {
    t = await createTenant();
    customerId = await createCustomer(t);
    bus = t.app.get(EventBus);
  });
  afterAll(async () => t?.close());

  const login = (email: string) =>
    request(t.app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD, deviceId: DEVICE_ID, appVersion: '0.7.0' });

  /** Collects events for this company until `stop` returns true. */
  function collect(sessionId: string): { events: LiveEvent[]; sub: { unsubscribe(): void } } {
    const events: LiveEvent[] = [];
    const sub = bus.stream(t.companyId, sessionId).subscribe((e) => events.push(e));
    return { events, sub };
  }

  it('lists live sessions with a seat counter and marks the caller', async () => {
    const second = await login('admin@demo.local');
    expect(second.status).toBe(201);
    const list = await http(t).get('/auth/sessions');
    expect(list.status).toBe(200);
    expect(list.body.activeCount).toBeGreaterThanOrEqual(2);
    expect(list.body.sessions.some((s: { current: boolean }) => s.current)).toBe(true);
    expect(list.body.sessions[0]).toHaveProperty('deviceName');
  });

  it('revoke kills the refresh token, the access token and the open stream', async () => {
    const other = await login('admin@demo.local');
    const sid = other.body.refreshToken.split('.')[0];
    const { events, sub } = collect(sid);
    let completed = false;
    const sub2 = bus.stream(t.companyId, sid).subscribe({ complete: () => (completed = true) });

    const revoked = await http(t).post(`/auth/sessions/${sid}/revoke`, {});
    expect(revoked.status).toBe(201);
    expect(revoked.body.revoked).toBe(1);

    expect(completed).toBe(true);
    const refresh = await request(t.app.getHttpServer()).post('/auth/refresh').send({ refreshToken: other.body.refreshToken });
    expect(refresh.status).toBe(401);
    const me = await http(t, other.body.accessToken).get('/auth/me');
    expect(me.status).toBe(401);
    sub.unsubscribe();
    sub2.unsubscribe();
    expect(events).toHaveLength(0);
  });

  it('publishes draft.updated, presence and invoice.issued for the company', async () => {
    const admin = await login('admin@demo.local');
    const sid = admin.body.refreshToken.split('.')[0];
    const { events, sub } = collect(sid);

    const draft = await createDraftInvoice(t, customerId);
    const edit = await http(t).patch(`/invoices/${draft.id}`, { notes: 'x', lines: [invoiceLine(t)] }, draft.version);
    expect(edit.status).toBe(200);
    const presence = await http(t).post(`/invoices/${draft.id}/presence`, {});
    expect(presence.status).toBe(201);
    const issued = await issueInvoice(t, draft.id);
    expect(issued.status).toBe(201);

    const types = events.map((e) => e.type);
    expect(types).toContain('draft.updated');
    const pres = events.find((e) => e.type === 'presence');
    expect(pres?.data.invoiceId).toBe(draft.id);
    expect(pres?.data.userName).toBeTruthy();
    expect(events.find((e) => e.type === 'invoice.issued')?.data.number).toBe(issued.body.number);
    sub.unsubscribe();
  });

  it('events are company-scoped', () => {
    const seen: LiveEvent[] = [];
    const sub = bus.stream('00000000-0000-0000-0000-000000000000', 'nobody').subscribe((e) => seen.push(e));
    bus.publish(t.companyId, 'payment.created', { paymentId: 'p' });
    sub.unsubscribe();
    expect(seen).toHaveLength(0);
  });

  it('GET /events requires a token', async () => {
    const res = await request(t.app.getHttpServer()).get('/events');
    expect(res.status).toBe(401);
  });
});
