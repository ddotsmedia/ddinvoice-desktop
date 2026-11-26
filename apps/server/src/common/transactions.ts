import { Prisma } from '@ddinvoice/db';
import type { Db, Tx } from '../core/prisma.service';

const MAX_ATTEMPTS = 4; // first attempt + 3 retries on serialization failure

function isSerializationFailure(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /40001|could not serialize|write conflict/i.test(msg);
}

/** One SERIALIZABLE transaction; retried up to 3 times on 40001 / P2034 with jittered backoff. */
export async function withSerializable<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction((tx) => fn(tx), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      if (!isSerializationFailure(e) || attempt >= MAX_ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * attempt));
    }
  }
}
