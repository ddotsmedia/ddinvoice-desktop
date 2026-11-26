/**
 * Pending commands for when the server is unreachable. Each command keeps the Idempotency-Key it was first sent with,
 * so a resend after a dropped response is deduplicated by the server (no double issue, no double payment).
 * Stored in localStorage under one key; ordering is preserved and the first retriable failure stops the flush.
 */

export interface PendingCommand {
  id: string;
  method: 'POST' | 'PATCH';
  path: string;
  body?: unknown;
  idempotencyKey: string;
  ifMatch?: number;
  createdAt: string;
  attempts: number;
}

export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OutboxSender {
  post(path: string, opts: { body?: unknown; idempotencyKey: string; ifMatch?: number }): Promise<unknown>;
  patch(path: string, opts: { body?: unknown; idempotencyKey: string; ifMatch?: number }): Promise<unknown>;
}

/** Thrown by a sender for a network or 5xx failure (retry later). Any other error means the server rejected the command. */
export class RetriableError extends Error {}

const KEY = 'ddi.outbox.v1';

/** Exponential backoff: 1 s, 2 s, 4 s … capped at 30 s. */
export function nextDelayMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempts));
}

export class Outbox {
  constructor(private readonly storage: OutboxStorage) {}

  list(): PendingCommand[] {
    try {
      const raw = this.storage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as PendingCommand[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(list: PendingCommand[]): void {
    this.storage.setItem(KEY, JSON.stringify(list));
  }

  /** Adds a command unless one with the same idempotency key is already queued. */
  enqueue(cmd: Omit<PendingCommand, 'id' | 'createdAt' | 'attempts'>): PendingCommand {
    const list = this.list();
    const existing = list.find((c) => c.idempotencyKey === cmd.idempotencyKey);
    if (existing) return existing;
    const entry: PendingCommand = { ...cmd, id: cmd.idempotencyKey, createdAt: new Date().toISOString(), attempts: 0 };
    this.write([...list, entry]);
    return entry;
  }

  /**
   * Sends queued commands in order. Success or a server rejection (4xx) removes the command; a RetriableError keeps it
   * (with attempts incremented) and stops the flush so later commands never overtake earlier ones.
   * Returns how many were sent and how many remain.
   */
  async flush(sender: OutboxSender): Promise<{ sent: number; remaining: number }> {
    let sent = 0;
    for (const cmd of this.list()) {
      try {
        const opts = { body: cmd.body, idempotencyKey: cmd.idempotencyKey, ...(cmd.ifMatch !== undefined ? { ifMatch: cmd.ifMatch } : {}) };
        if (cmd.method === 'POST') await sender.post(cmd.path, opts);
        else await sender.patch(cmd.path, opts);
        this.remove(cmd.id);
        sent += 1;
      } catch (e) {
        if (e instanceof RetriableError) {
          this.bump(cmd.id);
          break;
        }
        // Rejected by the server (validation, conflict, already issued): drop it, the UI already showed the reason.
        this.remove(cmd.id);
      }
    }
    return { sent, remaining: this.list().length };
  }

  remove(id: string): void {
    this.write(this.list().filter((c) => c.id !== id));
  }

  private bump(id: string): void {
    this.write(this.list().map((c) => (c.id === id ? { ...c, attempts: c.attempts + 1 } : c)));
  }
}

/** The app's outbox, backed by localStorage (survives a renderer reload while offline). */
export function persistentOutbox(): Outbox {
  return new Outbox(window.localStorage);
}

/** Dispatched after a command is queued so the flusher sends it without waiting for the next tick. */
export const OUTBOX_CHANGED = 'ddi:outbox-changed';
