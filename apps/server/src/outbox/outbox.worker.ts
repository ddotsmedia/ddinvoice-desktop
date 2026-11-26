import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, OUTBOX_HANDLERS } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';

export interface OutboxJob {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
}
export type OutboxHandler = (job: OutboxJob) => Promise<void>;

export const POLL_MS = 2_000;
export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 10;

/** Exponential backoff: 10 s, 20 s, 40 s … capped at 1 h. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** attempts, 3_600_000);
}

/** Polls Outbox for this company: claims due rows under a 60 s lease, runs the topic handler, retries with backoff. */
@Injectable()
export class OutboxWorker {
  private readonly log = new Logger('OutboxWorker');
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(OUTBOX_HANDLERS) private readonly handlers: Map<string, OutboxHandler>,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.tick()
        .catch((e: unknown) => this.log.error(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          this.busy = false;
        });
    }, POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One polling pass. Returns the number of jobs handled (done or rescheduled). */
  async tick(now = new Date(), batch = 10): Promise<number> {
    const companyId = this.config.companyId;
    const jobs = await this.prisma.client.$queryRaw<OutboxJob[]>`
      UPDATE "Outbox" SET status = 'PROCESSING', "leaseUntil" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = now()
      WHERE id IN (
        SELECT id FROM "Outbox"
        WHERE "companyId" = ${companyId}
          AND (
            (status = 'PENDING' AND "nextAttemptAt" <= ${now})
            OR (status = 'PROCESSING' AND "leaseUntil" < ${now})
          )
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, topic, payload, attempts`;

    const db = this.prisma.scoped(companyId);
    for (const job of jobs) {
      const attempts = job.attempts + 1;
      try {
        const handler = this.handlers.get(job.topic);
        if (!handler) throw new Error(`No handler registered for ${job.topic}`);
        await handler(job);
        await db.outbox.update({
          where: { id: job.id },
          data: { status: 'DONE', attempts, leaseUntil: null, lastError: null },
        });
      } catch (e) {
        const failed = attempts >= MAX_ATTEMPTS;
        await db.outbox.update({
          where: { id: job.id },
          data: {
            status: failed ? 'FAILED' : 'PENDING',
            attempts,
            leaseUntil: null,
            nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
            lastError: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
          },
        });
      }
    }
    return jobs.length;
  }
}
