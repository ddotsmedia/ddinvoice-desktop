/** Channel names. Kept free of zod so the sandboxed preload can import it. */
/** Channel names, one place. */
export const CHANNELS = {
  appVersion: 'app:version',
  configGet: 'config:get',
  configSet: 'config:set',
  authLoad: 'auth:load',
  authStoreTokens: 'auth:storeTokens',
  authClear: 'auth:clear',
  serverDiscover: 'server:discover',
  serverProbe: 'server:probe',
  serverPair: 'server:pair',
  setupInstallServer: 'setup:installServer',
  printPdf: 'print:pdf',
  fileSaveAs: 'file:saveAs',
  updateState: 'update:state',
  updateBlockers: 'update:blockers',
  updateInstall: 'update:install',
  shellOpenExternal: 'shell:openExternal',
} as const;
