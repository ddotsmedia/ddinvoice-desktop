import { z } from 'zod';

/** Shared by main (validation), preload (typed bridge) and renderer (types). Never import Node/Electron here. */

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Field shapes without defaults. Patches use these so `.partial()` never injects default values over stored settings. */
const CONFIG_FIELDS = {
  locale: z.enum(LOCALES),
  role: z.enum(['main', 'workstation']).nullable(),
  setupDone: z.boolean(),
  serverOrigin: z.string().nullable(),
  /** PEM of the server's local CA, confirmed by the user at pairing time. */
  caPem: z.string().nullable(),
  caFingerprint: z.string().nullable(),
  deviceId: z.string().nullable(),
  /** Random per-install device identity sent as `fingerprint` during pairing. */
  deviceFingerprint: z.string().nullable(),
};

/** Persisted settings: every field has a default so an empty or older file still parses. */
export const ConfigSchema = z.object({
  locale: CONFIG_FIELDS.locale.default('en'),
  role: CONFIG_FIELDS.role.default(null),
  setupDone: CONFIG_FIELDS.setupDone.default(false),
  serverOrigin: CONFIG_FIELDS.serverOrigin.default(null),
  caPem: CONFIG_FIELDS.caPem.default(null),
  caFingerprint: CONFIG_FIELDS.caFingerprint.default(null),
  deviceId: CONFIG_FIELDS.deviceId.default(null),
  deviceFingerprint: CONFIG_FIELDS.deviceFingerprint.default(null),
});
export type AppConfig = z.infer<typeof ConfigSchema>;

export const ConfigPatchSchema = z.object(CONFIG_FIELDS).partial();
export type ConfigPatch = z.infer<typeof ConfigPatchSchema>;

export const TokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type Tokens = z.infer<typeof TokensSchema>;

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
export const FingerprintSchema = z.string().regex(FINGERPRINT);

export const ProbeSchema = z.object({ origin: z.url({ protocol: /^https$/ }).max(300) });
export type ProbeInput = z.infer<typeof ProbeSchema>;

export const ProbeResultSchema = z.object({ caPem: z.string().min(1), caFingerprint: FingerprintSchema });
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export const PairSchema = z.object({
  origin: z.url({ protocol: /^https$/ }).max(300),
  code: z.string().regex(/^\d{6}$/),
  caPem: z.string().min(1).max(10_000),
  caFingerprint: FingerprintSchema,
  deviceName: z.string().min(1).max(100),
});
export type PairInput = z.infer<typeof PairSchema>;

export const PairResultSchema = z.object({ deviceId: z.string().min(1) });
export type PairResult = z.infer<typeof PairResultSchema>;

export const DiscoveredServerSchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().positive(),
  origin: z.string(),
});
export type DiscoveredServer = z.infer<typeof DiscoveredServerSchema>;

export const SaveAsSchema = z.object({
  suggestedName: z.string().min(1).max(200),
  extension: z.enum(['pdf', 'csv', 'zip']),
  dataBase64: z.string().min(1).max(50_000_000),
});
export type SaveAsInput = z.infer<typeof SaveAsSchema>;

export const PrintPdfSchema = z.object({
  suggestedName: z.string().min(1).max(200),
  html: z.string().min(1).max(5_000_000),
});
export type PrintPdfInput = z.infer<typeof PrintPdfSchema>;

export const InstallServerSchema = z.object({
  companyNameEn: z.string().min(1).max(200),
  companyNameAr: z.string().min(1).max(200),
  trn: z.string().regex(/^\d{15}$/),
  emirate: z.enum(['ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH']),
  adminEmail: z.email().max(254),
  adminPassword: z.string().min(12).max(200),
});
export type InstallServerInput = z.infer<typeof InstallServerSchema>;

export const InstallServerResultSchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  caFingerprint: FingerprintSchema,
});
export type InstallServerResult = z.infer<typeof InstallServerResultSchema>;

export const OpenExternalSchema = z.object({ url: z.url({ protocol: /^https$/ }).max(500) });

/** The complete surface exposed as `window.ddi`. */
export interface DdiApi {
  app: { version(): Promise<string> };
  config: { get(): Promise<AppConfig>; set(patch: ConfigPatch): Promise<AppConfig> };
  auth: { load(): Promise<Tokens | null>; storeTokens(t: Tokens): Promise<void>; clear(): Promise<void> };
  server: {
    discover(): Promise<DiscoveredServer[]>;
    probe(input: ProbeInput): Promise<ProbeResult>;
    pair(input: PairInput): Promise<PairResult>;
  };
  setup: { installServer(input: InstallServerInput): Promise<InstallServerResult> };
  print: { pdf(input: PrintPdfInput): Promise<{ saved: boolean }> };
  file: { saveAs(input: SaveAsInput): Promise<{ saved: boolean }> };
  update: {
    state(): Promise<{ status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'; version: string | null; blocked: boolean }>;
    setBlockers(b: { unsyncedDrafts: number; openPayrollRun: boolean }): Promise<void>;
    install(): Promise<boolean>;
  };
  shell: { openExternal(url: string): Promise<void> };
}
