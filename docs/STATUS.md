# Status
Phase 4 Server runtime: done (server 0.5.0). Phase 3 Local API, Phase 4 db schema, Phase 2 CI/release: done.
- Server: apps/server (Nest 10), guards: Throttler, Pairing (X-Device-Id), JWT, Permission; Idempotency, Audit.
- Runtime: pnpm vendor (PG 16.9, Node 22.23.4, WinSW 3 -> vendor/, gitignored); pnpm bundle:server -> dist/{server,worker,setup}.cjs.
- Setup CLI: node dist/setup.cjs install-server|uninstall-server|status|migrate|rotate-cert|pairing-code (src/setup/cli.ts).
- Postgres: 127.0.0.1:47821, scram only, roles ddinvoice_owner/ddinvoice_app; secrets DPAPI in secrets.bin; pre-migrate pg_dump + auto restore.
- TLS: local CA 10y + server cert 2y (node-forge); GET /pairing/ca; mDNS _ddinvoice._tcp (bonjour-service).
- Pairing: 6-digit code, 10 min, single use; POST /pairing; unpaired rejected except /pairing, /health.
- Tests: server 46 + db 38; smoke: tools/scripts/smoke-server.ps1 (process mode) passes.
- NOT verified here: service mode (WinSW install, firewall, LocalService) needs an elevated PC; run install-server elevated to confirm.
- Deferred: users/roles/companies/branches/items/sequences admin, documents render (P6), e-invoice (P11), installer packaging of prisma CLI.
- Known: journal drafts need schema change; payments AED-only; dependabot alerts unchanged.
Next: Prompt 5.
