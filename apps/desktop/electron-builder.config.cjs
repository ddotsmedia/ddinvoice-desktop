/* eslint-disable @typescript-eslint/no-require-imports */
/** electron-builder config. Signing uses Azure Trusted Signing when all five AZURE_* secrets are set; otherwise the build is unsigned (warning, not failure). */
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const env = process.env;
const signKeys = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE'];
const missing = signKeys.filter((k) => !env[k]);
const signed = missing.length === 0;
if (!signed) console.warn(`[dist] WARNING: building UNSIGNED installer (missing ${missing.join(', ')})`);

const win = { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'DDInvoice-Setup-${version}.${ext}' };
if (signed) {
  win.azureSignOptions = {
    endpoint: env.AZURE_SIGNING_ENDPOINT || 'https://weu.codesigning.azure.net',
    codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
    certificateProfileName: env.AZURE_CERT_PROFILE,
    // electron-updater compares the update's signer with this name before installing.
    publisherName: env.AZURE_PUBLISHER_NAME || undefined,
  };
}

module.exports = {
  appId: 'ae.ddotsmedia.ddinvoice',
  productName: 'DDInvoice',
  executableName: 'DDInvoice',
  directories: { output: path.join(root, 'release'), buildResources: path.join(__dirname, 'build') },
  files: ['out/**/*', 'package.json'],
  asar: true,
  publish: [{ provider: 'github', owner: 'ddotsmedia', repo: 'ddinvoice-desktop' }],
  extraResources: [
    { from: path.join(root, 'dist'), to: 'dist', filter: ['**/*'] }, // server, worker, setup, prisma, templates + fonts, chrome-headless-shell
    { from: path.join(root, 'vendor', 'node'), to: 'vendor/node' },
    { from: path.join(root, 'vendor', 'pgsql'), to: 'vendor/pgsql' },
    { from: path.join(root, 'vendor', 'winsw'), to: 'vendor/winsw' },
  ],
  win,
  nsis: {
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    include: path.join(__dirname, 'build', 'installer.nsh'),
  },
};
