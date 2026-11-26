import { Injectable } from '@nestjs/common';

/**
 * In-process FIFO per key (companyId). Number allocation and posting run one at a time per company,
 * so Serializable conflicts are rare; the transaction retry in `withSerializable` covers the rest.
 */
@Injectable()
export class SerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}
