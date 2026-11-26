import { BrowserWindow, app, net, protocol, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPinned, type Pin } from './tls';
import { buildCsp } from './csp';

/** Renderer assets are served from this privileged scheme so the CSP can be set on every response. */
export const APP_ORIGIN = 'app://ddi';
const ALLOWED_EXTERNAL_HOSTS = new Set(['github.com']);

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

export interface SecurityContext {
  serverOrigin: () => string | null;
  pin: () => Pin | null;
  rendererDir: string;
}

/** Registers the app:// handler (prod) and session-wide deny rules. Call once before creating windows. */
export function installSecurity(ctx: SecurityContext): void {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = join(ctx.rendererDir, rel);
    if (!file.startsWith(ctx.rendererDir) || !existsSync(file)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', buildCsp(ctx.serverOrigin(), null));
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  });

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  // Only the paired server is decided here; every other host keeps Chromium's default verification (-3).
  ses.setCertificateVerifyProc((req, cb) => cb(verifyPinned(ctx.pin(), req.hostname, req.certificate.data)));
}

/** Dev only: the Vite dev server is plain http on localhost, so CSP is applied through webRequest. */
export function applyDevCsp(devUrl: string, serverOrigin: () => string | null): void {
  const origin = new URL(devUrl).origin;
  session.defaultSession.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [buildCsp(serverOrigin(), origin)] } });
  });
}

export function isTrustedUrl(url: string, devUrl: string | null): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (devUrl !== null && url.startsWith(new URL(devUrl).origin));
}

export function createMainWindow(devUrl: string | null, appUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  const wc = win.webContents;
  wc.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url, devUrl)) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!isTrustedUrl(url, devUrl)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());
  void win.loadURL(appUrl);
  return win;
}

/** Only https links on the allowlist leave the app, and they open in the system browser. */
export async function openExternal(url: string): Promise<boolean> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) return false;
  await shell.openExternal(parsed.toString());
  return true;
}
