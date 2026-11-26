import { Bonjour } from 'bonjour-service';
import type { ServerConfig } from './config';
import { SERVER_VERSION } from './version';

/** Advertises _ddinvoice._tcp with TXT {companyId, name, version}. Returns a stop function. */
export function advertise(config: ServerConfig): () => void {
  const bonjour = new Bonjour();
  const name = config.companyName ?? 'DDInvoice';
  bonjour.publish({
    name,
    type: 'ddinvoice',
    protocol: 'tcp',
    port: config.port,
    txt: { companyId: config.companyId, name, version: SERVER_VERSION },
  });
  return () => {
    bonjour.unpublishAll(() => bonjour.destroy());
  };
}
