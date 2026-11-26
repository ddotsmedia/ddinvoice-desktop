# Status
Phase 3 Local API: done (server 0.4.0). Phase 4 db schema: done. Phase 2 CI/release: done.
- Server: apps/server (Nest 10), global JwtGuard + PermissionGuard, Idempotency, Audit, ApiError filter.
- Modules: auth, health, system, customers, periods, reference (accounts, tax-codes), invoices, credit-notes, quotes, payments, journals.
- Worker: src/worker.ts polls Outbox (2 s, lease 60 s, backoff, 10 attempts); stub handlers.
- OpenAPI: /api/docs in development only; pnpm --filter @ddinvoice/server gen:client -> contracts client.
- Tests: apps/server/test (29) + db (38); run with pnpm test. Lint, typecheck, build green.
- Deferred: users/roles/companies/branches/items/sequences admin, documents render (P6), e-invoice (P11), Windows service (P4).
- Known: journal drafts need schema change; payments AED-only; 114 dependabot alerts on GitHub (unchanged).
Next: Prompt 4 server runtime (Windows services, bundling, worker service).
