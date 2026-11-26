// Usage: node smoke-check.mjs <dataDir> <port> <adminEmail> <adminPassword> <pairingCode>
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { join } from 'node:path';

const [dataDir, port, email, password, code] = process.argv.slice(2);
const ca = readFileSync(join(dataDir, 'pki', 'ca.crt'));

function call(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = request(
      { host: '127.0.0.1', port, path, method, ca, servername: 'localhost', headers: { 'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, body: b.startsWith('{') ? JSON.parse(b) : null, text: b }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}
const expect = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  if (!ok) process.exitCode = 1;
};

const fp = 'smoke-device-' + Date.now();
const h = await call('GET', '/health');
expect('GET /health = 200', h.status === 200, h.text);
const unpaired = await call('GET', '/customers', undefined, { 'x-device-id': fp });
expect('unpaired device rejected (403)', unpaired.status === 403, unpaired.text.slice(0, 80));
const caRes = await call('GET', '/pairing/ca');
expect('GET /pairing/ca returns PEM', caRes.status === 200 && caRes.text.includes('BEGIN CERTIFICATE'));
const bad = await call('POST', '/pairing', { code: '000000' === code ? '111111' : '000000', deviceName: 'smoke', fingerprint: fp });
expect('wrong pairing code rejected', bad.status === 403, String(bad.status));
const paired = await call('POST', '/pairing', { code, deviceName: 'smoke-pc', fingerprint: fp });
expect('pairing works', paired.status === 201 && !!paired.body?.caFingerprint, paired.text.slice(0, 120));
const login = await call('POST', '/auth/login', { email, password, deviceId: fp }, { 'x-device-id': fp });
expect('login after pairing', login.status === 201, String(login.status));
const ok = await call('GET', '/customers', undefined, { 'x-device-id': fp, authorization: `Bearer ${login.body?.accessToken}` });
expect('authorized call after pairing', ok.status === 200, String(ok.status));
