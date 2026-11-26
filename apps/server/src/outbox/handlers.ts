import type { OutboxHandler } from './outbox.worker';

/** Stub: e-invoice submission lands in Prompt 11 and succeeds so the queue drains. document.render is wired in worker.ts. */
export const STUB_HANDLERS: [string, OutboxHandler][] = [['einvoice.submit', async () => undefined]];
