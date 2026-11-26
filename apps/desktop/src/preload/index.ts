import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/channels';
import type { DdiApi } from '../shared/ipc';

/** The only surface the renderer gets. Each method maps to one fixed channel; validation happens in main. */
const api: DdiApi = {
  app: { version: () => ipcRenderer.invoke(CHANNELS.appVersion) },
  config: {
    get: () => ipcRenderer.invoke(CHANNELS.configGet),
    set: (patch) => ipcRenderer.invoke(CHANNELS.configSet, patch),
  },
  auth: {
    load: () => ipcRenderer.invoke(CHANNELS.authLoad),
    storeTokens: (t) => ipcRenderer.invoke(CHANNELS.authStoreTokens, t),
    clear: () => ipcRenderer.invoke(CHANNELS.authClear),
  },
  server: {
    discover: () => ipcRenderer.invoke(CHANNELS.serverDiscover),
    probe: (input) => ipcRenderer.invoke(CHANNELS.serverProbe, input),
    pair: (input) => ipcRenderer.invoke(CHANNELS.serverPair, input),
  },
  setup: { installServer: (input) => ipcRenderer.invoke(CHANNELS.setupInstallServer, input) },
  print: { pdf: (input) => ipcRenderer.invoke(CHANNELS.printPdf, input) },
  file: { saveAs: (input) => ipcRenderer.invoke(CHANNELS.fileSaveAs, input) },
  shell: { openExternal: (url) => ipcRenderer.invoke(CHANNELS.shellOpenExternal, url) },
};

contextBridge.exposeInMainWorld('ddi', Object.freeze(api));
