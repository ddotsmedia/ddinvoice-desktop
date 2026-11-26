import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CHANNELS } from '../shared/channels';
import {
  InstallServerSchema,
  OpenExternalSchema,
  PairSchema,
  PrintPdfSchema,
  ProbeSchema,
  SaveAsSchema,
  TokensSchema,
  type AppConfig,
  type PairResult,
} from '../shared/ipc';
import type { ConfigStore } from './config-store';
import { discoverServers } from './discovery';
import { installServer } from './setup';
import { BlockersSchema, getUpdateState, installNow, setBlockers } from './updater';
import { isTrustedUrl, openExternal } from './window';
import { printPdf, saveAs } from './files';
import type { TokenStore } from './token-store';
import { fingerprintOf, pinnedJson, probeServer, type Pin } from './tls';

/** Settings a renderer may change. Server binding (origin, CA, device ids) is only written by server:pair. */
const RENDERER_WRITABLE = z.object({ locale: z.enum(['en', 'ar']), role: z.enum(['main', 'workstation']), setupDone: z.boolean() }).partial();

export interface IpcDeps {
  config: ConfigStore;
  tokens: TokenStore;
  devUrl: string | null;
  getWindow: () => BrowserWindow | null;
}

export function pinFrom(config: AppConfig): Pin | null {
  return config.serverOrigin && config.caPem ? { origin: config.serverOrigin, caPem: config.caPem } : null;
}

/** Every handler: trusted sender check, Zod validation of the payload, then one narrow action. */
export function registerIpc(deps: IpcDeps): void {
  const handle = <T>(channel: string, schema: z.ZodType<T> | null, fn: (input: T, e: IpcMainInvokeEvent) => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, (e, raw: unknown) => {
      if (!isTrustedUrl(e.senderFrame?.url ?? '', deps.devUrl)) throw new Error('Untrusted sender');
      const input = (schema ? schema.parse(raw) : undefined) as T;
      return fn(input, e);
    });
  };

  handle(CHANNELS.appVersion, null, () => app.getVersion());
  handle(CHANNELS.configGet, null, () => deps.config.get());
  handle(CHANNELS.configSet, RENDERER_WRITABLE, (patch) => deps.config.set(patch));

  handle(CHANNELS.authLoad, null, () => deps.tokens.load());
  handle(CHANNELS.authStoreTokens, TokensSchema, (t) => deps.tokens.store(t));
  handle(CHANNELS.authClear, null, () => deps.tokens.clear());

  handle(CHANNELS.serverDiscover, null, () => discoverServers());
  handle(CHANNELS.serverProbe, ProbeSchema, (input) => probeServer(input.origin));
  handle(CHANNELS.serverPair, PairSchema, async (input): Promise<PairResult> => {
    if (fingerprintOf(input.caPem) !== input.caFingerprint) throw new Error('CA fingerprint does not match the certificate');
    const cfg = deps.config.get();
    const deviceFingerprint = cfg.deviceFingerprint ?? randomBytes(32).toString('hex');
    const pin: Pin = { origin: input.origin, caPem: input.caPem };
    const res = await pinnedJson(pin, 'POST', '/pairing', { code: input.code, deviceName: input.deviceName, fingerprint: deviceFingerprint });
    const body = (res.json ?? {}) as { deviceId?: string; caFingerprint?: string; message?: string };
    if (res.status !== 200 && res.status !== 201) throw new Error(body.message ?? `Pairing failed (HTTP ${res.status})`);
    if (body.caFingerprint !== input.caFingerprint || !body.deviceId) throw new Error('Server identity changed during pairing');
    deps.config.set({
      serverOrigin: input.origin,
      caPem: input.caPem,
      caFingerprint: input.caFingerprint,
      deviceId: body.deviceId,
      deviceFingerprint,
    });
    return { deviceId: body.deviceId };
  });

  handle(CHANNELS.setupInstallServer, InstallServerSchema, (input) => installServer(input));
  handle(CHANNELS.updateState, null, () => getUpdateState());
  handle(CHANNELS.updateBlockers, BlockersSchema, (b) => setBlockers(b));
  handle(CHANNELS.updateInstall, null, () => installNow());
  handle(CHANNELS.printPdf, PrintPdfSchema, (input) => printPdf(deps.getWindow(), input));
  handle(CHANNELS.fileSaveAs, SaveAsSchema, (input) => saveAs(deps.getWindow(), input));
  handle(CHANNELS.shellOpenExternal, OpenExternalSchema, async (input) => {
    const opened = await openExternal(input.url);
    if (!opened) throw new Error('Link is not on the allowlist');
  });
}

