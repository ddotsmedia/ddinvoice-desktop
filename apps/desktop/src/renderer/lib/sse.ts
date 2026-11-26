/** Server-Sent Events parsing and the event-to-query mapping for live updates. Pure, so it is unit tested. */

export interface SseMessage {
  id?: string;
  type: string;
  data: string;
}

/** Splits a text buffer into complete SSE messages; `rest` is the unfinished tail to keep for the next chunk. */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const messages: SseMessage[] = [];
  for (const block of blocks) {
    let type = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') type = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
    }
    if (data.length > 0) messages.push({ id, type, data: data.join('\n') });
  }
  return { messages, rest };
}

export interface LiveEnvelope {
  id: number;
  type: string;
  companyId: string;
  at: string;
  data: Record<string, unknown>;
}

/** Query keys to invalidate for a server event. Presence is not a query; it is handled by the presence store. */
export function invalidationKeys(type: string, data: Record<string, unknown>): unknown[][] {
  switch (type) {
    case 'invoice.issued':
    case 'payment.created':
      return [['invoices'], ['invoice']];
    case 'draft.updated':
      return [['invoices'], ['invoice', String(data.invoiceId ?? '')]];
    default:
      return [];
  }
}

export interface PresenceEntry {
  invoiceId: string;
  userId: string;
  userName: string;
  at: number;
}

/** A presence entry is shown for this long after the last heartbeat; the editor heartbeats every 10 s. */
export const PRESENCE_TTL_MS = 30_000;

export function parseEnvelope(raw: string): LiveEnvelope | null {
  try {
    const v = JSON.parse(raw) as LiveEnvelope;
    return typeof v?.type === 'string' ? v : null;
  } catch {
    return null;
  }
}
