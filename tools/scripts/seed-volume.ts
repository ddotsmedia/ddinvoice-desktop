/**
 * Volume fixture for the load test. Writes N issued invoices (one line each, 210.00 gross), a balanced journal per
 * invoice, and N/2 payments (every even invoice paid in full, with allocation and a balanced bank journal).
 *
 * Test-only: rows are written with raw SQL inside one transaction with triggers disabled
 * (session_replication_role = replica), because issued-document guards would otherwise block inserting lines for
 * already-issued invoices. The load script then checks the result independently (duplicates, journal balance) with SQL.
 * Never point this at a non-test database.
 */

/** Minimal slice of a Prisma client: transaction + raw execute. */
export interface VolumeDb {
  $transaction<T>(fn: (tx: { $executeRawUnsafe(query: string): Promise<unknown> }) => Promise<T>, opts?: { timeout?: number; maxWait?: number }): Promise<T>;
}

export interface VolumeOptions {
  companyId: string;
  invoices: number;
  customerIds: string[];
  accounts: { ar: string; bank: string; revenue: string };
  taxCodeId: string;
}

export interface VolumeResult {
  invoices: number;
  invoiceLines: number;
  payments: number;
  journals: number;
  journalLines: number;
}

const ID = /^[0-9a-f-]{36}$/i;

function assertIds(values: string[]): void {
  for (const v of values) if (!ID.test(v)) throw new Error(`Refusing to seed with a non-uuid id: ${v}`);
}

/** Builds the statements. Exported so the SQL can be reviewed without a database. */
export function volumeStatements(o: VolumeOptions): string[] {
  assertIds([o.companyId, o.taxCodeId, o.accounts.ar, o.accounts.bank, o.accounts.revenue, ...o.customerIds]);
  if (!Number.isInteger(o.invoices) || o.invoices < 2 || o.invoices % 2 !== 0) throw new Error('invoices must be an even integer >= 2');
  if (o.customerIds.length === 0) throw new Error('at least one customer is required');

  const c = `'${o.companyId}'`;
  const N = o.invoices;
  const customers = `ARRAY[${o.customerIds.map((id) => `'${id}'`).join(',')}]::text[]`;
  const issue = `(CURRENT_DATE - ((g % 365)::int))`;
  const inv = (x: string) => `md5(${c} || 'inv' || ${x})::uuid::text`;
  const pay = (x: string) => `md5(${c} || 'pay' || ${x})::uuid::text`;
  const jr = (x: string) => `md5(${c} || 'jrnl' || ${x})::uuid::text`;
  const pj = (x: string) => `md5(${c} || 'pjrnl' || ${x})::uuid::text`;
  const s: string[] = [];

  s.push(`INSERT INTO "Invoice" (id,"companyId","createdAt","updatedAt",number,"customerId",status,"settlementStatus","issueDate",currency,"fxRate",subtotal,"discountTotal","taxTotal",total,"totalAed","amountPaid",notes,terms,version,"issuedAt","dueDate")
SELECT ${inv('g')}, ${c}, now(), now(), 'SEED-' || lpad(g::text, 7, '0'), (${customers})[(g % cardinality(${customers})) + 1],
  'ISSUED', (CASE WHEN g % 2 = 0 THEN 'PAID' ELSE 'UNPAID' END)::"SettlementStatus", ${issue}, 'AED', 1, 200, 0, 10, 210, 210,
  CASE WHEN g % 2 = 0 THEN 210 ELSE 0 END, '', '', 1, now(), ${issue} + 30
FROM generate_series(1, ${N}) g`);

  s.push(`INSERT INTO "InvoiceLine" (id,"companyId","createdAt","updatedAt","invoiceId","lineNo",description,qty,"unitPrice","discountPct","discountAmt","taxCodeId",net,tax,gross,"accountId")
SELECT md5(${c} || 'line' || g)::uuid::text, ${c}, now(), now(), ${inv('g')}, 1, 'Consulting', 2, 100, 0, 0, '${o.taxCodeId}', 200, 10, 210, '${o.accounts.revenue}'
FROM generate_series(1, ${N}) g`);

  s.push(`INSERT INTO "Journal" (id,"companyId","createdAt","updatedAt",number,date,source,"sourceId",memo,"postedAt")
SELECT ${jr('g')}, ${c}, now(), now(), 'SEED-J-' || lpad(g::text, 7, '0'), ${issue}, 'INVOICE', ${inv('g')}, 'Seed invoice', now()
FROM generate_series(1, ${N}) g`);

  s.push(`INSERT INTO "JournalLine" (id,"companyId","createdAt","updatedAt","journalId","accountId",debit,credit,description)
SELECT md5(${c} || 'jl-ar' || g)::uuid::text, ${c}, now(), now(), ${jr('g')}, '${o.accounts.ar}', 210, 0, 'Seed AR' FROM generate_series(1, ${N}) g`);
  s.push(`INSERT INTO "JournalLine" (id,"companyId","createdAt","updatedAt","journalId","accountId",debit,credit,description)
SELECT md5(${c} || 'jl-rev' || g)::uuid::text, ${c}, now(), now(), ${jr('g')}, '${o.accounts.revenue}', 0, 210, 'Seed revenue' FROM generate_series(1, ${N}) g`);

  // Payments: every even invoice, paid in full.
  s.push(`INSERT INTO "Payment" (id,"companyId","createdAt","updatedAt",number,"customerId",date,method,"bankAccountId",amount,currency,"fxRate",unallocated,reference)
SELECT ${pay('g')}, ${c}, now(), now(), 'SEED-P-' || lpad(g::text, 7, '0'), (${customers})[(g % cardinality(${customers})) + 1], ${issue}, 'BANK', '${o.accounts.bank}', 210, 'AED', 1, 0, ''
FROM generate_series(2, ${N}, 2) g`);
  s.push(`INSERT INTO "Allocation" (id,"companyId","createdAt","updatedAt","paymentId","invoiceId",amount,date)
SELECT md5(${c} || 'alloc' || g)::uuid::text, ${c}, now(), now(), ${pay('g')}, ${inv('g')}, 210, ${issue} FROM generate_series(2, ${N}, 2) g`);
  s.push(`INSERT INTO "Journal" (id,"companyId","createdAt","updatedAt",number,date,source,"sourceId",memo,"postedAt")
SELECT ${pj('g')}, ${c}, now(), now(), 'SEED-PJ-' || lpad(g::text, 7, '0'), ${issue}, 'PAYMENT', ${pay('g')}, 'Seed payment', now()
FROM generate_series(2, ${N}, 2) g`);
  s.push(`INSERT INTO "JournalLine" (id,"companyId","createdAt","updatedAt","journalId","accountId",debit,credit,description)
SELECT md5(${c} || 'pl-bank' || g)::uuid::text, ${c}, now(), now(), ${pj('g')}, '${o.accounts.bank}', 210, 0, 'Seed bank' FROM generate_series(2, ${N}, 2) g`);
  s.push(`INSERT INTO "JournalLine" (id,"companyId","createdAt","updatedAt","journalId","accountId",debit,credit,description)
SELECT md5(${c} || 'pl-ar' || g)::uuid::text, ${c}, now(), now(), ${pj('g')}, '${o.accounts.ar}', 0, 210, 'Seed AR' FROM generate_series(2, ${N}, 2) g`);
  return s;
}

/** Writes the fixture in one transaction with triggers off (see file header). */
export async function seedVolume(db: VolumeDb, o: VolumeOptions): Promise<VolumeResult> {
  const statements = volumeStatements(o);
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      for (const sql of statements) await tx.$executeRawUnsafe(sql);
    },
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );
  return {
    invoices: o.invoices,
    invoiceLines: o.invoices,
    payments: o.invoices / 2,
    journals: o.invoices + o.invoices / 2,
    journalLines: o.invoices * 2 + o.invoices,
  };
}
