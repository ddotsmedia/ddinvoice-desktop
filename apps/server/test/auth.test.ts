import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { addUser, createTenant, DEVICE_ID, http, PASSWORD, skipDb, type Tenant } from './helpers';

const d = describe.skipIf(skipDb);

d('auth', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await createTenant();
  });
  afterAll(async () => t?.close());

  const login = (email: string, password: string) =>
    request(t.app.getHttpServer()).post('/auth/login').send({ email, password, deviceId: DEVICE_ID });

  it('logs in and returns the caller with permissions', async () => {
    const res = await http(t).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@demo.local');
    expect(res.body.permissions).toContain('invoice.issue');
  });

  it('rotates the refresh token and revokes the session on reuse', async () => {
    const first = await login('admin@demo.local', PASSWORD);
    expect(first.status).toBe(201);
    const rotated = await request(t.app.getHttpServer()).post('/auth/refresh').send({ refreshToken: first.body.refreshToken });
    expect(rotated.status).toBe(201);
    expect(rotated.body.refreshToken).not.toBe(first.body.refreshToken);

    const reused = await request(t.app.getHttpServer()).post('/auth/refresh').send({ refreshToken: first.body.refreshToken });
    expect(reused.status).toBe(401);

    const afterReuse = await request(t.app.getHttpServer()).post('/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the access session', async () => {
    const s = await login('admin@demo.local', PASSWORD);
    const out = await http(t, s.body.accessToken).post('/auth/logout');
    expect(out.status).toBe(201);
    const me = await http(t, s.body.accessToken).get('/auth/me');
    expect(me.status).toBe(401);
  });

  it('returns INVALID_CREDENTIALS without revealing which part failed', async () => {
    const res = await login('admin@demo.local', 'wrong-password-value');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account for 15 minutes after 5 failed attempts', async () => {
    const locked = await createTenant();
    try {
      const attempt = (pw: string) =>
        request(locked.app.getHttpServer()).post('/auth/login').send({ email: 'admin@demo.local', password: pw, deviceId: DEVICE_ID });
      for (let i = 0; i < 5; i++) expect((await attempt('bad-password-xyz')).status).toBe(401);
      const blocked = await attempt(PASSWORD);
      expect(blocked.status).toBe(423);
      expect(blocked.body.code).toBe('ACCOUNT_LOCKED');
    } finally {
      await locked.close();
    }
  });

  it('denies a command when the role lacks the permission', async () => {
    await addUser(t, 'sales@demo.local', 'sales');
    const s = await request(t.app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'sales@demo.local', password: PASSWORD, deviceId: DEVICE_ID });
    const res = await http(t, s.body.accessToken).post('/periods', { start: '2030-01-01', end: '2030-12-31' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('requires Idempotency-Key on commands', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${t.token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fields).toHaveProperty('Idempotency-Key');
  });
});
