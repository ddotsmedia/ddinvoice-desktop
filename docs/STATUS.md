## Prompt 9 (0.10.0)
- One NSIS installer (perMachine, role page, /S /ROLE=server|workstation). Server role runs setup CLI install-server --deferred; the wizard then calls configure-server. Update on a server PC: migrate --restart (pre-migrate backup). Uninstall keeps data unless ticked and confirmed twice.
- electron-updater (GitHub ddotsmedia/ddinvoice-desktop, latest + pilot), no downgrades, install only when no unsynced drafts / open payroll run. Signing: Azure Trusted Signing when 5 secrets set, else unsigned with warning.
- release.yml pilot job: lint, typecheck, test, vendor, dist, smoke, prerelease. Promote copies to latest.
- smoke-installer.ps1 passes in CI (windows-latest, elevated): silent install, 3 services, /health 200, uninstall, data kept. It found 5 real bugs (node_modules dropped by extraResources, Prisma CLI closure, initdb restricted token ACLs, LocalService logs ACL, SCM start race), all fixed.
- Not verified here: local smoke (no elevation; see TESTING.md), signing, updater against a real release, installer UI pages (built, not clicked).
- Open: AZURE_PUBLISHER_NAME repo variable must match the certificate subject for signature verification; payroll blocker pending a payroll module.

# Status
Prompt 8 Backup, restore, health, licensing, support bundle, data export: server 0.9.0, desktop 0.9.0. Prompts 1-7: done.

## Prompt 8 results (server, CLI, tests; desktop screens not built)
- Backup: AES-256-GCM sealed archive (manifest + pg_dump -Fc). Key in secrets.bin (DPAPI). Recovery key printed once at install (stdout only). Legacy installs: `ddinvoice-setup backup-key`.
- Schedule: worker checks every 60 s; hourly archive when due; daily and monthly promoted copies; retention 48 / 30 / 12 (manual 20); Settings target `backupCopyDir` gets daily copies. Documents are a content-addressed encrypted blob store, GC'd with retention.
- Verify per backup: decrypt, dump sha256, `pg_restore --list`; BackupRecord row (OK / FAILED).
- Restore (CLI only): `ddinvoice-setup restore --file <f> [--recovery-key <k>]` on this PC; `ddinvoice-setup install-server --restore <f> --recovery-key <k>` on a new PC. Restore into `<db>_restore`, verify counts and trial balance against the manifest, write documents, rename live to `<db>_pre_restore_<stamp>`, mark RECOVERY MODE.
- Recovery mode: `Company.recoveryMode` (migration 20261126000200). External outbox rows are not claimed until `POST /ops/recovery/release`. `GET /ops/recovery` lists the pending external rows.
- Licensing: Ed25519 `DDL1.<payload>.<sig>` files verified with the embedded public key. Trial (unsigned, 30 days, 3 seats, all modules) created at install. Seats = user+device pairs with a live session (403 SEAT_LIMIT). Module gates (403 MODULE_NOT_LICENSED). Expired / invalid / missing / past-grace → READ_ONLY (403 LICENSE_READ_ONLY on commands). `POST /ops/license` installs; tampered or foreign-signed files get 422 LICENSE_INVALID.
- Vendor issuing: `LICENSE_SIGNING_KEY=<pem> pnpm exec tsx tools/license/issue-license.ts --company-id … --company-name … --trn … --seats … --modules … [--expires YYYY-MM-DD] --out x.ddlic`. Private key: `%USERPROFILE%\.ddinvoice-vendor\license-signing-ed25519.pem` (outside the repo). Verified end to end with the embedded key.
- Health: `GET /ops/health` (backup.read): services (api, postgres, worker heartbeat), DB size, disk free with warn < 10 GB, last good backup and `stale` (> 26 h), queue counts, failed jobs, certificate expiry, versions, migrations, connected devices, license state.
- Failed jobs: `POST /ops/outbox/:id/retry` (FAILED → PENDING), `POST /ops/outbox/:id/dismiss` (FAILED → DONE, note kept).
- Support bundle: `GET /ops/support-bundle` (zip: README, versions, health, migrations, redacted log tails). No database.
- Data export: `POST /ops/export` writes `<dataDir>\exports\<stamp>\` (CSV per business table, documents, manifest with sha256). Credentials excluded.
- Backups now: `POST /ops/backups/run`; list `GET /ops/backups`.

## Verified here
- `pnpm lint` and `pnpm typecheck` pass.
- `pnpm test`: server suite 103 tests pass, including new `ops-units`, `ops-backup` (round trip with the vendored pg_dump / pg_restore on the embedded test cluster), and `ops-api` (seat limit, module gate, expired read-only, tampered license, health, support bundle redaction, export, recovery release, outbox retry/dismiss).
- Round-trip test is skipped where `vendor/pgsql/bin` has no pg_dump (set `DD_PG_BIN_DIR` to override).

## Prompt 8 desktop (0.9.1)
- Settings: Server health (services, DB size, disk warn < 10 GB, last backup, queue, failed jobs retry/dismiss, certificate, versions, devices), Backup (list, Back up now, recovery list with Release after review), Data export, License (status, install), Help (support bundle zip).
- Shell banners: recovery mode, backup older than 26 h, read-only license. Nav items gated by permission.
- i18n en and ar keys (ops.*, banner.*, nav.health/help/export); parity test passes; Arabic not natively reviewed.
- Tests: desktop ops.test.ts (staleness, disk warn, size format, nav gating); pnpm test 209 server+desktop passing; lint and typecheck pass.

## Not done in Prompt 8 (open)
- Restore has no UI trigger (CLI only, by decision). Settings target (backupCopyDir) and cloud target not in UI.
- Desktop screens are not exercised in a running Electron app here (no e2e); Playwright e2e still open.
- node-cron replaced by an interval (see DECISIONS). Backups read the whole archive in memory.
- App-role pg_dump only verified on the superuser test cluster; verify on a real install.
- Offline grace not active until the online check exists (Prompt 10). Cloud backup target is Prompt 10.
- Existing server 0.8.x installs: run ddinvoice-setup backup-key once.

## Carried over from Prompt 7 (still open)
- Two-Electron Playwright e2e not written; no cross-instance SSE timing check.
- Admin sessions screen (API only). Offline queue covers Issue only; outbox not encrypted.
- Presence not replayed to late joiners. Load run not done over LAN with the desktop app.

## Prompt 7 (previous)
Load: invoice list p95 99.1 ms over 100k invoices; 0 duplicate invoice or journal numbers; 0 unbalanced journals (`pnpm load`).
Next: Prompt 9.
