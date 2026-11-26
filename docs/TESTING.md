# Testing

## Installer smoke (`tools/scripts/smoke-installer.ps1`)
Runs in CI (elevated). Locally it needs an elevated PowerShell and a PC with no DDInvoice data (it refuses if `%PROGRAMDATA%\DDInvoice\server.json` exists).
`pnpm --filter @ddinvoice/desktop dist` then `./tools/scripts/smoke-installer.ps1`.

## Windows Sandbox (no elevation on the dev PC)
1. Enable "Windows Sandbox" (Windows Features), reboot.
2. Save `ddinvoice.wsb`: a mapped folder `D:\Websites\ddinvoice-desktop` to `C:\src` (read-only) and a LogonCommand `powershell -ExecutionPolicy Bypass -File C:\src\tools\scripts\smoke-installer.ps1 -Installer C:\src\release\DDInvoice-Setup-<version>.exe`.
3. Open the .wsb, read the console for `SMOKE OK`. Sandbox is disposable, so the real ProgramData is untouched.
4. Manual checks: run the installer without `/S` and confirm the Install type page; uninstall with the box ticked and see two confirmations.
