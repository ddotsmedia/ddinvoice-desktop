# Status
Phase 5 Desktop shell: partial (desktop 0.6.0). Server 0.6.0. Phases 1-4: done.
- Desktop: electron-vite; main hardening (sandbox, CSP via app://, nav/window.open blocked, single instance, safeStorage tokens, CA pin); typed preload.
- Wizard: language, role, Main PC install (CLI --input, elevated, unverified here) or workstation discovery, pairing, login. Version gate.
- Screens: Overview (partial figures), invoice register (server paging, columns, saved views, CSV, preview), invoice editor (grid keys, autosave 5s, Ctrl+S, issue with Idempotency-Key).
- Other nav items: placeholder only. Missing: Ctrl+K, offline mode and drafts store, Playwright smoke, items/customers/credit notes/receipts/journals/periods/settings.
- Tests: desktop 32 (grid, totals, nav by permission, i18n parity, RTL/Testing Library); root pnpm test passes.
- Not verified here: install-server elevated run; live login against a server.
Next: Prompt 6.
