import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSession } from './session';
import { invalidationKeys, parseEnvelope, parseSse, PRESENCE_TTL_MS, type PresenceEntry } from './sse';
import { ApiError, type Api } from './api';
import { nextDelayMs, OUTBOX_CHANGED, persistentOutbox, RetriableError } from './outbox';

/** Server unreachable or 5xx: keep the command and retry. Anything else is a real answer and the command is dropped. */
function asRetriable<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) throw new RetriableError(e.message);
    throw e;
  });
}

/** Sends queued commands when the outbox changes and on a backoff timer while anything is pending. */
function useOutboxFlusher(api: Api | null): void {
  useEffect(() => {
    if (!api) return;
    let timer = 0;
    let stopped = false;
    const sender = {
      post: (path: string, o: { body?: unknown; idempotencyKey: string; ifMatch?: number }) => asRetriable(api.post(path, o)),
      patch: (path: string, o: { body?: unknown; idempotencyKey: string; ifMatch?: number }) => asRetriable(api.patch(path, o)),
    };
    const tick = async () => {
      const box = persistentOutbox();
      if (box.list().length > 0) await box.flush(sender);
      const head = box.list()[0];
      if (!stopped) timer = window.setTimeout(tick, head ? nextDelayMs(head.attempts) : 30_000);
    };
    const onChanged = () => {
      window.clearTimeout(timer);
      void tick();
    };
    window.addEventListener(OUTBOX_CHANGED, onChanged);
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener(OUTBOX_CHANGED, onChanged);
    };
  }, [api]);
}

interface LiveValue {
  presence: Record<string, PresenceEntry>;
}

const LiveContext = createContext<LiveValue>({ presence: {} });

/** Who else is editing a draft right now (from the server's presence events), or null. */
export function usePresence(invoiceId: string | undefined): PresenceEntry | null {
  const { presence } = useContext(LiveContext);
  const entry = invoiceId ? presence[invoiceId] : undefined;
  return entry && Date.now() - entry.at < PRESENCE_TTL_MS ? entry : null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Holds one SSE stream to GET /events while signed in. Entity events invalidate the matching TanStack Query keys;
 * presence events fill the badge store. Reconnects with exponential backoff (1 s to 30 s).
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { api, me, permissions } = useSession();
  const qc = useQueryClient();
  const [presence, setPresence] = useState<Record<string, PresenceEntry>>({});
  const canRead = permissions.has('invoice.read');
  useOutboxFlusher(api);

  useEffect(() => {
    if (!api || !me || !canRead) return;
    const ac = new AbortController();

    const handle = (type: string, data: unknown) => {
      if (type === 'presence') {
        const p = data as { invoiceId?: string; userId?: string; userName?: string };
        if (!p.invoiceId || !p.userId) return;
        const entry: PresenceEntry = { invoiceId: p.invoiceId, userId: p.userId, userName: p.userName ?? '', at: Date.now() };
        setPresence((prev) => ({ ...prev, [entry.invoiceId]: entry }));
        window.setTimeout(() => {
          setPresence((prev) => {
            const cur = prev[entry.invoiceId];
            if (!cur || Date.now() - cur.at < PRESENCE_TTL_MS) return prev;
            const next = { ...prev };
            delete next[entry.invoiceId];
            return next;
          });
        }, PRESENCE_TTL_MS + 100);
        return;
      }
      for (const key of invalidationKeys(type, (data ?? {}) as Record<string, unknown>)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    };

    void (async () => {
      let backoff = 1000;
      while (!ac.signal.aborted) {
        try {
          const res = await api.openStream('/events', ac.signal);
          backoff = 1000;
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSse(buffer);
            buffer = parsed.rest;
            for (const m of parsed.messages) {
              const env = parseEnvelope(m.data);
              if (env) handle(env.type, env.data);
            }
          }
        } catch {
          // Offline or unauthorized: fall through to the backoff and reconnect.
        }
        if (ac.signal.aborted) return;
        await sleep(backoff, ac.signal);
        backoff = Math.min(backoff * 2, 30_000);
      }
    })();

    return () => ac.abort();
  }, [api, me, canRead, qc]);

  return <LiveContext.Provider value={{ presence }}>{children}</LiveContext.Provider>;
}
