# Status
Prompt 7 Multi-PC hardening: server 0.8.0, desktop 0.8.0. Prompts 1-6: done.

## Prompt 7 results
- Load (pnpm load, 100k invoices, 50k payments, 10 VUs, 180 s over HTTP): invoice list p95 **99.1 ms** (budget < 1000 ms); duplicate invoice numbers **0**; duplicate journal numbers **0**; unbalanced journals **0**; 4,400 requests, 0 errors, 880 invoices issued and paid.
- Concurrency: draft PATCH requires If-Match; stale version returns 409 VERSION_CONFLICT with the current record; desktop conflict dialog shows mine vs theirs per field and lets the user keep mine or take theirs.
- Live: GET /events (SSE, per company, heartbeat 25 s) pushes invoice.issued, payment.created, draft.updated, presence; desktop invalidates matching query keys and shows the 'is editing' badge. Logout and revoke close the stream.
- Sessions: GET /auth/sessions (activeCount + devices), POST /auth/sessions/:id/revoke (kills refresh and access). Seat enforcement: Prompt 8.
- Version: client below minClient -> Update required; client above server -> Main PC needs update. Clock: desktop warns above 5 min skew.
- Offline: Issue queued in localStorage with its Idempotency-Key, resent with the same key on reconnect; backoff 1 s to 30 s.

## Not done in Prompt 7 (open)
- Item 8: two-Electron Playwright e2e not written; no simultaneous-issue or cross-instance SSE timing check (3 s) has been run.
- Item 3: admin sessions screen not built (API only).
- Item 4: only Issue is queued offline; draft PATCH offline is not queued; outbox is not encrypted (phase spec wants the encrypted main-process store).
- Item 2: SSE and presence are not exercised in a running Electron app; no wire-format test for /events (only the bus and 401 are tested).
- Presence is not replayed to clients that connect after a heartbeat.
- Load run was not executed with the desktop app or over a LAN; it is single-process, one company.

## Verified here
- pnpm lint, pnpm typecheck, pnpm test: all green (169 tests).
- Commands: pnpm load (runs tools/scripts/load.ts via tsx; exits 1 on any failed assertion).

## Prompt 6 (previous)
Prompt 6 Documents: server 0.7.0, desktop 0.7.0. Phases 1-4: done. Phase 5 desktop shell: partial.
- Renderer: puppeteer-core 25.19.0 + vendored chrome-headless-shell 158.0.8127.88 (sha256 in tools/scripts/fetch-chrome.ts). Browser recycled every 200 renders; JS off; network blocked except bundled fonts (file://).
- Templates packages/documents/templates/v1: invoice, credit-note + partials (header, parties, lines, totals, tax-summary, bank-details, references, footer, styles). Handlebars strict. Languages en, ar (rtl), bi.
- Snapshot: seller/buyer/supplyDate/taxRate/CN lines frozen at issue; templateVersion v1.
- Worker: document.render per language (en, ar, bi) → %dataDir%\documents\<yyyy>\<docType>\<number>-<lang>.pdf + Document row; idempotent per snapshot+language.
- API: GET /documents/:docType/:docId/pdf?lang= (document.read; 409 PDF_PENDING until archived); POST /documents/preview (DRAFT watermark, not stored).
- Samples: docs/samples/*.pdf (fictional parties).
- Tests: documents package 9; server documents 21 (fixtures x en/ar/bi, 200-line paging, pdfjs text, idempotency, company change leaves sha unchanged, API). Root pnpm test: 146 pass.
- Not done: desktop Print (Ctrl+P); receipt, quote, statement templates; bank details data; per-customer language; Document unique index (migration).
- Not verified here: bundled worker run with the bundle (script copies assets; not started); CI run.
Next: Prompt 7.
