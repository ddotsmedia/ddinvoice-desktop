import { Bonjour } from 'bonjour-service';
import type { DiscoveredServer } from '../shared/ipc';

const SERVICE_TYPE = 'ddinvoice'; // _ddinvoice._tcp
const BROWSE_MS = 3000;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** mDNS browse for the Local API servers on the LAN. Resolves after 3 seconds with whatever was found. */
export function discoverServers(browseMs = BROWSE_MS): Promise<DiscoveredServer[]> {
  const bonjour = new Bonjour();
  const found = new Map<string, DiscoveredServer>();
  const browser = bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' }, (svc) => {
    const host = (svc.addresses ?? []).find((a) => IPV4.test(a)) ?? svc.host.replace(/\.$/, '');
    const origin = `https://${host}:${svc.port}`;
    found.set(origin, { name: svc.name, host, port: svc.port, origin });
  });
  return new Promise((resolve) => {
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve([...found.values()]);
    }, browseMs);
  });
}
