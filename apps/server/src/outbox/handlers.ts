import type { OutboxHandler } from './outbox.worker';

/** Stubs: rendering lands in Prompt 6 and e-invoice submission in Prompt 11. They succeed so the queue drains. */
export const STUB_HANDLERS: [string, OutboxHandler][] = [
  ['document.render', async () => undefined],
  ['einvoice.submit', async () => undefined],
];
