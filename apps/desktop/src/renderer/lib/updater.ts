import { useCallback, useEffect, useState } from 'react';
import { OUTBOX_CHANGED, persistentOutbox } from './outbox';

export interface UpdateInfo {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  version: string | null;
  blocked: boolean;
}

/** Reports unsynced work to main (which gates install) and exposes update state. Payroll is not built yet: always false. */
export function useUpdater(): { info: UpdateInfo | null; install: () => void } {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    const tick = async (): Promise<void> => {
      try {
        await window.ddi.update.setBlockers({ unsyncedDrafts: persistentOutbox().list().length, openPayrollRun: false });
        setInfo(await window.ddi.update.state());
      } catch { /* not available (tests / dev) */ }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 15_000);
    window.addEventListener(OUTBOX_CHANGED, tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(OUTBOX_CHANGED, tick);
    };
  }, []);
  const install = useCallback(() => void window.ddi.update.install(), []);
  return { info, install };
}
