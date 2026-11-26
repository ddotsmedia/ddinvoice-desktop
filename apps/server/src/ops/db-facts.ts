import type { PrismaClient } from '@ddinvoice/db';

/** Raw query runner (Prisma $queryRawUnsafe). Used only for ops reads: counts, trial balance, sizes, exports. */
export type Query = (sql: string, ...params: unknown[]) => Promise<Record<string, unknown>[]>;

export const queryOf = (prisma: PrismaClient): Query => (sql, ...params) => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);

/** Tables that carry a companyId column, plus Company itself (keyed by id). Derived from the live schema. */
export async function tenantTables(query: Query): Promise<string[]> {
  const rows = await query(
    `SELECT table_name AS name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'companyId' ORDER BY table_name`,
  );
  return rows.map((r) => String(r.name));
}

/** Row counts for every table of this company. The Company row is counted by its id. */
export async function companyCounts(query: Query, companyId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const rows = await query(`SELECT COUNT(*)::int AS n FROM "Company" WHERE id = $1`, companyId);
  counts.Company = Number(rows[0]?.n ?? 0);
  for (const table of await tenantTables(query)) {
    const n = await query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE "companyId" = $1`, companyId);
    counts[table] = Number(n[0]?.n ?? 0);
  }
  return counts;
}

/** Sums of journal lines per account code. A balanced ledger has total debit = total credit. */
export async function trialBalance(query: Query, companyId: string): Promise<{ code: string; debit: string; credit: string }[]> {
  const rows = await query(
    `SELECT a.code AS code, COALESCE(SUM(jl.debit), 0)::text AS debit, COALESCE(SUM(jl.credit), 0)::text AS credit
     FROM "JournalLine" jl JOIN "Account" a ON a.id = jl."accountId"
     WHERE jl."companyId" = $1
     GROUP BY a.code ORDER BY a.code`,
    companyId,
  );
  return rows.map((r) => ({ code: String(r.code), debit: String(r.debit), credit: String(r.credit) }));
}

export async function databaseSizeBytes(query: Query): Promise<number> {
  const rows = await query(`SELECT pg_database_size(current_database())::bigint AS n`);
  return Number(rows[0]?.n ?? 0);
}

/** Same counts and trial balance as the manifest? Returns the first mismatch, or undefined. */
export function compareFacts(
  expected: { counts: Record<string, number>; trialBalance: { code: string; debit: string; credit: string }[] },
  actual: { counts: Record<string, number>; trialBalance: { code: string; debit: string; credit: string }[] },
): string | undefined {
  for (const [table, n] of Object.entries(expected.counts)) {
    if (actual.counts[table] !== n) return `row count mismatch in ${table}: expected ${n}, restored ${actual.counts[table] ?? 'missing'}`;
  }
  const a = JSON.stringify(expected.trialBalance);
  const b = JSON.stringify(actual.trialBalance);
  if (a !== b) return 'trial balance mismatch after restore';
  return undefined;
}
