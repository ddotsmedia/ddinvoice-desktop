import { app, BrowserWindow } from 'electron';
import { ConfigStore } from './config-store';
import { registerIpc, pinFrom } from './ipc';
import { TokenStore } from './token-store';
import { APP_ORIGIN, applyDevCsp, createMainWindow, installSecurity } from './window';
import { startUpdater } from './updater';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Dev server URL when running under electron-vite dev; undefined in packaged builds. */
const devUrl = process.env['ELECTRON_RENDERER_URL'] ?? null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  const config = new ConfigStore();
  const tokens = new TokenStore();
  const serverOrigin = (): string | null => config.get().serverOrigin;
  const pin = () => pinFrom(config.get());

  const appUrl = devUrl ?? `${APP_ORIGIN}/index.html`;

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    installSecurity({ serverOrigin, pin, rendererDir: join(__dirname, '../renderer') });
    if (devUrl) applyDevCsp(devUrl, serverOrigin);
    registerIpc({ config, tokens, devUrl, getWindow: () => win, });
    win = createMainWindow(devUrl, appUrl);
    win.on('closed', () => (win = null));
    startUpdater();
    // Installer wrote the chosen role; adopt it until the user finishes setup.
    if (!config.get().setupDone && config.get().role === null) {
      try {
        const r = (JSON.parse(readFileSync(join(process.env['PROGRAMDATA'] ?? 'C:\ProgramData', 'DDInvoice', 'role.json'), 'utf8')) as { role?: string }).role;
        if (r === 'server' || r === 'workstation') config.set({ role: r === 'server' ? 'main' : 'workstation' });
      } catch { /* no installer role file */ }
    }
  });

  app.on('window-all-closed', () => app.quit());
}
