import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '@ddinvoice/ui';
import type { Connection } from '../lib/session';

const TONE: Record<Connection, BadgeTone> = { connected: 'success', reconnecting: 'warning', offline: 'danger' };
const KEY: Record<Connection, string> = { connected: 'connection.connected', reconnecting: 'connection.reconnecting', offline: 'connection.serverOffline' };

export function ConnectionBadge({ state }: { state: Connection }) {
  const { t } = useTranslation();
  return (
    <Badge tone={TONE[state]} role="status" aria-live="polite">
      {t(KEY[state])}
    </Badge>
  );
}
