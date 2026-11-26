/**
 * Load test: boots the real server on an embedded Postgres (same bootstrap as the test suite), seeds 100k invoices and
 * 50k payments, then runs 10 virtual users over real HTTP for LOAD_SECONDS (default 180): create draft, edit, issue,
 * pay, list. Asserts: 0 duplicate invoice/journal numbers, every journal balanced (SQL), invoice list p95 < 1 s.
 *
 * Run: pnpm exec tsx tools/scripts/load.ts   (env: LOAD_SECONDS, LOAD_VUS, LOAD_INVOICES; defaults 180 / 10 / 100000)
 * Exit code 1 when an assertion fails. The summary JSON goes to stdout.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import setupDatabase from '../../packages/db/tests/global-setup';
import { createCustomer, createTenant, type Tenant } from '../../apps/server/test/helpers';
import { seedVolume, type VolumeDb } from './seed-volume';

const SECONDS = Number(process.env.LOAD_SECONDS ?? 180);
const VUS = Number(process.env.LOAD_VUS ?? 10);
const INVOICES = Number(process.env.LOAD_INVOICES ?? 100_000);
const LIST_P95_BUDGET_MS = 1000;

type Op = 'draft' | 'patch' | 'issue' | 'pay' | 'list';
interface Sample {
  op: Op;
  ms: number;
  ok: boolean;
}

const samples: Sample[] = [];
const errors: Record<string, number> = {};

function pct(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function main(): Promise<number> {
  const teardownDb = await setupDatabase();
  let t: Tenant | undefined;
  try {
    // Budget raised for the load run only; the production default stays 600 requests/minute per IP.
    t = await createTenant({ rateLimitPerMinute: 1_000_000 });
    const tenant = t;
    const customerIds: string[] = [];
    for (let i = 0; i < 50; i++) customerIds.push(await createCustomer(tenant, `LOAD-${randomUUID().slice(0, 8)}`));

    const seedStart = Date.now();
    const seeded = await seedVolume(tenant.prisma as unknown as VolumeDb, {
      companyId: tenant.companyId,
      invoices: INVOICES,
      customerIds,
      accounts: tenant.accounts,
      taxCodeId: tenant.taxCodes.sr,
    });
    const seedSeconds = (Date.now() - seedStart) / 1000;

    await tenant.app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(tenant.app.getHttpServer().address() as AddressInfo).port}`;

    async function call(
      op: Op,
      method: string,
      path: string,
      body: unknown,
      extra: Record<string, string> = {},
    ): Promise<{ status: number; json: { id?: string; version?: number; code?: string } }> {
      const started = performance.now();
      let status = 0;
      let json: { id?: string; version?: number; code?: string } = {};
      try {
        const res = await fetch(base + path, {
          method,
          headers: {
            Authorization: `Bearer ${tenant.token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': randomUUID(),
            ...extra,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        status = res.status;
        json = (await res.json().catch(() => ({}))) as typeof json;
      } catch {
        status = 0;
      }
      const ok = status >= 200 && status < 300;
      samples.push({ op, ms: performance.now() - started, ok });
      if (!ok) {
        const key = `${op}:${status}:${json.code ?? 'none'}`;
        errors[key] = (errors[key] ?? 0) + 1;
      }
      return { status, json };
    }

    const deadline = Date.now() + SECONDS * 1000;
    const line = { description: 'Load line', qty: '2', unitPrice: '100.00', taxCodeId: tenant.taxCodes.sr, accountId: tenant.accounts.revenue };
    const today = new Date().toISOString().slice(0, 10);

    async function virtualUser(): Promise<void> {
      while (Date.now() < deadline) {
        const customerId = customerIds[Math.floor(Math.random() * customerIds.length)]!;
        const draft = await call('draft', 'POST', '/invoices', { customerId, lines: [line] });
        if (draft.status !== 201 || !draft.json.id) continue;
        const id = draft.json.id;
        const patch = await call('patch', 'PATCH', `/invoices/${id}`, { notes: 'load' }, { 'If-Match': String(draft.json.version) });
        if (patch.status !== 200) continue;
        const issued = await call('issue', 'POST', `/invoices/${id}/issue`, undefined);
        if (issued.status !== 201) continue;
        await call('pay', 'POST', '/payments', {
          customerId,
          date: today,
          method: 'BANK',
          bankAccountId: tenant.accounts.bank,
          amount: '210.00',
          allocations: [{ invoiceId: id, amount: '210.00' }],
        });
        await call('list', 'GET', '/invoices?limit=50', undefined);
      }
    }

    const runStart = Date.now();
    await Promise.all(Array.from({ length: VUS }, () => virtualUser()));
    const runSeconds = (Date.now() - runStart) / 1000;

    // Independent checks in SQL, not through the API.
    const scalar = async (sql: string): Promise<number> => {
      const rows = (await tenant.prisma.$queryRawUnsafe(sql, tenant.companyId)) as Array<{ n: bigint | number }>;
      return Number(rows[0]!.n);
    };
    const duplicateInvoiceNumbers = await scalar(
      `SELECT COUNT(*) AS n FROM (SELECT number FROM "Invoice" WHERE "companyId" = $1 AND number IS NOT NULL GROUP BY number HAVING COUNT(*) > 1) d`,
    );
    const duplicateJournalNumbers = await scalar(
      `SELECT COUNT(*) AS n FROM (SELECT number FROM "Journal" WHERE "companyId" = $1 GROUP BY number HAVING COUNT(*) > 1) d`,
    );
    const unbalancedJournals = await scalar(
      `SELECT COUNT(*) AS n FROM (SELECT l."journalId" FROM "JournalLine" l WHERE l."companyId" = $1 GROUP BY l."journalId" HAVING SUM(l.debit) <> SUM(l.credit)) u`,
    );
    const invoiceCount = await scalar(`SELECT COUNT(*) AS n FROM "Invoice" WHERE "companyId" = $1`);
    const journalCount = await scalar(`SELECT COUNT(*) AS n FROM "Journal" WHERE "companyId" = $1`);

    const listMs = samples.filter((s) => s.op === 'list' && s.ok).map((s) => s.ms);
    const listP95 = pct(listMs, 95);
    const issued = samples.filter((s) => s.op === 'issue' && s.ok).length;
    const summary = {
      seed: { ...seeded, seconds: Number(seedSeconds.toFixed(1)) },
      run: { vus: VUS, seconds: Number(runSeconds.toFixed(1)), requests: samples.length, ok: samples.filter((s) => s.ok).length, issued, errors },
      invoiceListP95Ms: Number(listP95.toFixed(1)),
      invoiceListSamples: listMs.length,
      duplicateInvoiceNumbers,
      duplicateJournalNumbers,
      unbalancedJournals,
      invoiceCount,
      journalCount,
    };
    console.log(JSON.stringify(summary, null, 2));

    const failures: string[] = [];
    if (duplicateInvoiceNumbers !== 0) failures.push(`${duplicateInvoiceNumbers} duplicate invoice numbers`);
    if (duplicateJournalNumbers !== 0) failures.push(`${duplicateJournalNumbers} duplicate journal numbers`);
    if (unbalancedJournals !== 0) failures.push(`${unbalancedJournals} unbalanced journals`);
    if (!(listP95 < LIST_P95_BUDGET_MS)) failures.push(`invoice list p95 ${listP95.toFixed(1)} ms >= ${LIST_P95_BUDGET_MS} ms`);
    if (issued === 0) failures.push('no invoice was issued during the run');
    if (failures.length > 0) {
      console.error(`LOAD FAILED: ${failures.join('; ')}`);
      return 1;
    }
    console.error('LOAD PASSED');
    return 0;
  } finally {
    await t?.close();
    await teardownDb?.();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
