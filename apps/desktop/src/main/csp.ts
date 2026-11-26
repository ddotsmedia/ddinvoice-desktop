/** Content-Security-Policy builder. No Electron imports so it can be unit tested. */
/** Strict policy. connect-src is the paired server origin only (or none before pairing). */
export function buildCsp(serverOrigin: string | null, dev: string | null): string {
  const connect = ["'self'", ...(serverOrigin ? [serverOrigin] : [])];
  if (dev) connect.push(dev.replace(/^http/, 'ws'), dev);
  return [
    "default-src 'self'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}
