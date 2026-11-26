# Status
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
