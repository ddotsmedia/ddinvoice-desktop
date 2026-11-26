import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface Secrets {
  postgresPassword: string;
  ownerPassword: string;
  appPassword: string;
  /** Authorises loopback-only pairing-code issuance for the server screen / CLI. */
  localToken: string;
}

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const PROTECT =
  "Add-Type -AssemblyName System.Security;$i=[Console]::In.ReadToEnd();[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($i),$null,'LocalMachine'))";
const UNPROTECT =
  "Add-Type -AssemblyName System.Security;$i=[Console]::In.ReadToEnd().Trim();[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($i),$null,'LocalMachine'))";

/** DPAPI, LocalMachine scope: any process on this PC (the services) can decrypt; the file ACL gates access. Input goes via stdin, never argv. */
export function dpapiProtect(plain: string): string {
  return execFileSync('powershell.exe', [...PS, PROTECT], { input: plain, encoding: 'utf8' }).trim();
}
export function dpapiUnprotect(b64: string): string {
  return execFileSync('powershell.exe', [...PS, UNPROTECT], { input: b64, encoding: 'utf8' });
}

export function readSecrets(file: string, decrypt: (b64: string) => string = dpapiUnprotect): Secrets {
  return JSON.parse(decrypt(readFileSync(file, 'utf8'))) as Secrets;
}
