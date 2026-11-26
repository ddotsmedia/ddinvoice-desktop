# DDInvoice Desktop — Claude Code Build Prompts

Nov 26, 2026 · @Ddotsmedia

## How to use

Run the 17 prompts in order, one fresh Claude Code session per prompt, opened at `D:\Websites\ddinvoice-desktop`. Prompt 0 writes `CLAUDE.md` with every global rule, so later prompts stay short and Claude Code reads the rules from disk instead of you re-sending them.

1. Clone [ddotsmedia/ddinvoice-desktop](https://github.com/ddotsmedia/ddinvoice-desktop) inside `D:\Websites`: `git clone https://github.com/ddotsmedia/ddinvoice-desktop.git`
2. Set the model shown at the top of each prompt with `/model`.
3. Paste the prompt. Each one ends by running lint, typecheck and tests, updating `docs/STATUS.md`, committing and pushing to main; GitHub Actions then runs CI and publishes a pilot release (set up by Prompt 0b).
4. The next prompt reads `docs/STATUS.md` first, so no context is re-sent.

| # | Builds | Model | Why |
| --- | --- | --- | --- |
| 0 | Monorepo + rules | Sonnet | Architecture decisions |
| 1 | Financial engine | Sonnet | VAT, rounding, journal correctness |
| 2 | Database schema | Sonnet | Data model + triggers |
| 3 | Local API | Haiku | Standard NestJS on fixed schema |
| 4 | Server runtime | Sonnet | Windows services, bundling |
| 5 | Desktop UI | Haiku | Screens on existing API |
| 6 | PDF documents | Haiku | Templates + worker |
| 7 | Multi-user hardening | Haiku | Tests + small fixes |
| 8 | Backup, licensing | Haiku | Established patterns |
| 9 | Installer + CI | Sonnet | Packaging, signing |
| 10 | Cloud sync | Sonnet | Sync design + deploy |
| 11 | e-Invoicing | Sonnet | Regulatory mapping |
| 12 | Purchases | Haiku | Repeats invoice pattern |
| 13 | Banking | Haiku | Import + matching |
| 14 | Reports + VAT | Haiku | Queries on posted data |
| 15 | Payroll + WPS | Sonnet | High-liability rules |
| 16 | Acceptance | Haiku | Run gates, fix |

Target mix: 9 Haiku-friendly phases; switch back to Haiku after every Sonnet phase.

Safety: no prompt touches any VPS except Prompt 10, which deploys only through GitHub Actions to a new VPS (never srv988590), with a blast-radius check and post-deploy check of other sites. Zero-question automation is safe because destructive commands are banned outright in `CLAUDE.md`, so nothing needs confirming.

You supply later: code-signing secrets (Prompt 9), new-VPS SSH secrets (Prompt 10), ASP spec and sandbox credentials (Prompt 11 goes live only after), payroll owner inputs (Prompt 15). Until then the prompts use placeholders and mocks.

## Prompt 0 — Monorepo scaffold + CLAUDE.md

Model: Sonnet. Sets the structure and the rules every later prompt depends on.

```text
MODEL: Sonnet. TOKEN RULE: concise commands, minimal output, no explanations, diffs not rewrites, inline comments only, reuse existing patterns. AUTOMATION: never ask questions; decide, log in docs/DECISIONS.md, continue.

GOAL: Scaffold DDInvoice Desktop monorepo in current dir (Windows 11, Node 22 LTS, pnpm 9). Local-first, multi-PC, multi-user finance app for UAE SMEs. One installer, two roles: SERVER PC (PostgreSQL 16 + Local API + worker as Windows services) and WORKSTATION (Electron UI only, HTTPS to server API over LAN). Optional one-way sync to cloud. Package scope @ddinvoice/*.

CREATE:
pnpm-workspace.yaml: apps/*, packages/*
apps/desktop        Electron 33 + electron-vite + React 18 + TS (UI only)
apps/server         NestJS 10 Local API (Express) + worker entry src/worker.ts
apps/cloud-sync     NestJS sync receiver (empty package now, built in Prompt 10)
packages/domain     pure TS financial rules, only dep decimal.js
packages/contracts  Zod schemas, shared types, error codes, permissions
packages/db         Prisma schema, client, migrations, seed
packages/ui         Tailwind tokens + shadcn components
packages/documents  HTML invoice templates + fonts
tools/scripts       dev/test scripts
docs/               STATUS.md, DECISIONS.md, ARCHITECTURE.md
Root: tsconfig.base.json (strict, noUncheckedIndexedAccess), eslint flat config (typescript-eslint), prettier, vitest workspace, .editorconfig, .nvmrc (22), .gitignore (node_modules, dist, out, release, .env*, *.db, pgdata, vendor), package.json scripts dev/build/test/lint/typecheck via pnpm -r.

WRITE CLAUDE.md (root) with exactly these rules:
1 Automation: never ask questions; choose the option most consistent with this file; log it in docs/DECISIONS.md (date | decision | one-line reason).
2 Tokens: minimal output; never dump files; diffs not rewrites; read only files needed; no re-explaining.
3 Money: never JS number for money/qty/rates. decimal.js in domain; Prisma Decimal = PostgreSQL NUMERIC(18,4) amounts, NUMERIC(18,6) qty/rates; JSON carries decimals as strings. AED rounding 2dp half-up per packages/domain/src/rounding.ts.
4 Authority: only apps/server allocates numbers, posts journals, changes issued docs. Desktop never connects to the DB.
5 Issued records are immutable; corrections only via credit note / reversal journal.
6 Every command endpoint: auth guard, permission guard, Zod validation, Idempotency-Key header, one DB transaction, audit event.
7 Every posted journal balances: domain check + DB constraint trigger.
8 Every business table has companyId; every query filters by it (Prisma extension enforces).
9 Electron: contextIsolation true, nodeIntegration false, sandbox true, strict CSP, preload exposes a typed minimal API; secrets via safeStorage; no secrets in repo, installer or logs.
10 i18n: all UI text via i18next keys (en, ar); RTL via dir attribute; numbers/IDs/emails wrapped in <bdi>.
11 Tests: vitest; every feature adds tests; pnpm test must pass before commit.
12 Local only: never SSH, never touch any VPS, never run destructive commands (rm -rf outside repo, git reset --hard, git push --force, docker prune, dropdb on non-test DBs). Deployment only via GitHub Actions in Prompt 10.
13 End of every prompt: pnpm lint && pnpm typecheck && pnpm test; update docs/STATUS.md (done, key files, next, known issues; max 15 lines); git add -A; git commit -m '<phase>: <summary>'; git pull --rebase origin main; git push origin main (never --force; never with failing tests).
14 Pin exact versions; commit pnpm-lock.yaml.

ALSO:
- docs/ARCHITECTURE.md (max 60 lines): ascii role diagram, data flow, authority rule, ports: API 47820 HTTPS on LAN, PostgreSQL 47821 on 127.0.0.1 only, cloud-sync 47900.
- packages/contracts: ErrorCode enum + ApiError Zod schema.
- Minimal hello build in each app so pnpm build passes.
- .github/workflows/ci.yml: windows-latest; pnpm install --frozen-lockfile; lint; typecheck; test.

VERIFY: pnpm install; pnpm build; pnpm test; pnpm lint.
EXPECTED OUTPUT (max 10 lines): tree depth 2, commands passed, commit hash.
```

## Prompt 0b — Automate everything through GitHub Actions

Model: Haiku. A config change on an existing repo. After this, every prompt ends by pushing to main, CI checks it, and each green build becomes a pilot release; you promote a pilot to customers with one click.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, CLAUDE.md, .github/workflows/ci.yml, root package.json.

GOAL: Every change flows through GitHub Actions automatically. Repo: github.com/ddotsmedia/ddinvoice-desktop.

1 CLAUDE.md:
- Rule 12: keep 'never SSH / never touch any VPS / no destructive commands'; remove any wording that forbids git push.
- Rule 13 becomes: 'End of every prompt: pnpm lint && pnpm typecheck && pnpm test (stop and fix if any fail); update docs/STATUS.md; git add -A; git commit -m "<phase>: <summary>"; git pull --rebase origin main; git push origin main. Never --force, never push with failing tests, never rewrite history. After push run gh run watch on the CI run; if CI fails, fix, commit, push again until green.'
- New rule 15: 'Versioning: apps/desktop/package.json version is the product version (semver). Bump minor at the end of each numbered prompt, patch for fixes. Server and desktop share the version.'

2 .github/workflows/ci.yml: on push (all branches) + pull_request; concurrency group per ref, cancel-in-progress; windows-latest; actions/setup-node 22 + pnpm/action-setup (version from packageManager) + pnpm store cache; pnpm install --frozen-lockfile; lint; typecheck; test; build. Upload test results as artifact on failure.

3 .github/workflows/release.yml:
- on workflow_run of CI, branch main, conclusion success -> job pilot: read version V from apps/desktop/package.json; tag v<V>-pilot.<run_number>; if root script dist exists (from Prompt 9) build installer + latest.yml and attach; else attach source zip only; create GitHub prerelease (channel pilot) with notes from commits since previous tag.
- on workflow_dispatch input version (e.g. 0.3.0) -> job promote: find the newest pilot release of that version, create release v<version> (not prerelease, marked latest) with the same assets; this is what customer installs auto-update to.
- permissions: contents write; uses GITHUB_TOKEN only.

4 .github/dependabot.yml: npm (root, weekly, group minor+patch into one PR, ignore major) and github-actions (monthly).

5 Branch protection: if gh is authenticated, run gh api to require the CI check on main and block force pushes (non-destructive repo setting); otherwise write the exact steps in docs/DEPLOY.md.

6 docs/DEPLOY.md: release flow in 6 lines (push -> CI -> pilot prerelease -> test on pilot PC -> Actions > Release > Run workflow with version -> customers update).

VERIFY: commit and push per new rule 13; gh run watch until CI green; confirm a pilot prerelease appears (gh release list).
EXPECTED OUTPUT (max 8 lines): CI status, release tag created, branch protection applied or documented, commit hash.
```

## Prompt 0c — Auto-runner for all phases

Model: Haiku. Builds a PowerShell script that runs Prompts 1–16 one by one, each in a fresh headless Claude Code session on its own model, and stops on any failure. Before running it, export this doc as Markdown and save it as `D:\Websites\ddinvoice-desktop\docs\PHASES.md`.

````text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, docs/PHASES.md (headings only first).

GOAL: tools/run-phases.ps1 — unattended sequential runner for the phase prompts in docs/PHASES.md.

PARSE: each section heading '## Prompt <N> — <title>' with numeric N; prompt = first ```text fenced block in that section; model = value after 'MODEL:' on its first line (Sonnet -> sonnet, Haiku -> haiku; anything else -> stop with error). Ignore 0, 0b, 0c.

PARAMS: -From 1 -To 16 -Skip @() -DryRun (prints plan: phase, title, model, prompt length; runs nothing) -MaxRetries 2.

PRECHECKS (stop with message if any fail): cwd is repo root (CLAUDE.md exists); git branch is main; working tree clean; gh auth status ok; claude --version ok; latest CI run on main is success.

STATE: docs/phase-state.json {completed: [n...], skipped: [{n, reason}], runs: [{n, model, startedAt, endedAt, costUsd, attempts, commit}]}; completed phases are skipped so the script resumes after Ctrl+C or a stop.

GATES before a phase:
- 15: skip with reason 'payroll inputs missing' unless docs/payroll-inputs contains at least one file.
- 10: run normally (deploy job is skipped by GitHub when VPS secrets are empty).

RUN each phase: claude -p <prompt> --model <model> --dangerously-skip-permissions --output-format json --max-turns 300 > logs/phase-<NN>-a<attempt>.json (create logs/, gitignored). Parse result JSON for is_error and total_cost_usd.
VERIFY after each attempt: HEAD moved since phase start; working tree clean; HEAD pushed (git status shows not ahead); gh run list --branch main --workflow ci.yml --limit 1 for HEAD sha; gh run watch it; conclusion success.
ON FAILURE: retry up to -MaxRetries with a fix prompt: 'Phase <N> (<title>) did not finish: <reason>. Read docs/STATUS.md and logs/phase-<NN>-a<prev>.json tail, fix, then complete the original phase goal and end per CLAUDE.md rule 13.' Same model. Still failing -> write docs/RUN-REPORT.md (phase, reason, last 40 log lines) and exit 1.
ON SUCCESS: record in state; print one line: 'Phase N OK (<model>) <commit> $<cost>'; if model was sonnet print 'Complex phase complete. Next phase model: <next>'.
END: summary table (phase, model, attempts, cost), Haiku:Sonnet ratio, total cost; append to docs/RUN-REPORT.md; commit and push docs/phase-state.json + RUN-REPORT.md.

SAFETY: script itself runs only git status/log/pull --rebase/push, gh read commands and claude; never reset, clean, force or delete. Windows PowerShell 5.1 compatible.

VERIFY: powershell -File tools/run-phases.ps1 -DryRun prints 16 phases with correct models; commit and push per rule 13.
EXPECTED OUTPUT (max 8 lines): dry-run table summary, commit hash.
````

## Prompt 1 — Financial engine (packages/domain)

Model: Sonnet. Every later module reuses these rules, so correctness here matters most.

```text
MODEL: Sonnet. Follow CLAUDE.md. Read docs/STATUS.md only.

GOAL: packages/domain — pure deterministic financial engine, no I/O.

FILES (src/):
money.ts: Money (decimal.js + currency), add/sub/mul/round, fromString, toString(2dp), assertSameCurrency.
rounding.ts: roundLine(amount, dp=2, HALF_UP), roundDoc.
tax.ts: TaxCode {code: SR|ZR|EX|RC|OOS, rate, label}. UAE defaults SR 5%, ZR 0%, EX exempt, RC reverse charge (tax self-assessed, not charged to customer), OOS out of scope. calcLine({qty, unitPrice, discountPct?, discountAmt?, taxCode, priceIncludesTax}) -> {net, tax, gross}. calcDocument(lines, docDiscount?) -> {subtotal, discountTotal, taxableByCode, taxByCode, taxTotal, total}; round per line then sum (log decision).
fx.ts: convert(amount, rate) to AED base; documents keep currency, rate and AED equivalents.
numbering.ts: format(pattern, seq, date) for patterns like INV-{YYYY}-{SEQ:6}; parse. Never allocates (server does).
invoice-state.ts: document DRAFT -> ISSUED (void only via credit note); settlement UNPAID|PARTIAL|PAID|OVERPAID derived from allocations; delivery NOT_SENT|SENT; einvoice NOT_REQUIRED|PENDING|SUBMITTED|ACCEPTED|REJECTED. Transition functions throw DomainError on illegal moves.
journal.ts: JournalLine {accountCode, debit, credit, dims?}; assertBalanced; buildInvoiceJournal(invoice, accountMap): Dr AR total / Cr revenue per line account (net) / Cr VAT Output (tax); RC lines Dr VAT Input RC / Cr VAT Output RC. buildCreditNoteJournal (reverse). buildReceiptJournal (Dr Bank / Cr AR).
allocation.ts: allocate(payment, invoices) oldest-first default + manual; allocated <= open balance and <= unallocated payment; overpayment -> customer credit.
period.ts: isPeriodOpen(date, periods).
errors.ts: DomainError(code, message, details).
index.ts: exports.

FIXTURES tests/fixtures/*.json + tests:
simple SR invoice 3 lines; mixed SR/ZR/EX; tax-inclusive pricing; line + document discount; USD invoice at 3.6725; RC line; partial credit note; partial then full receipt; overpayment -> credit; rounding edges at .005; 200-line invoice; every journal balances.
Coverage threshold 95% lines (vitest config).

VERIFY: pnpm --filter @ddinvoice/domain test -- --coverage.
EXPECTED OUTPUT (max 8 lines): test count, coverage %, commit hash.
```

## Prompt 2 — Database schema, triggers, seed (packages/db)

Model: Sonnet. The same schema later feeds the cloud mirror, so it is built once here.

```text
MODEL: Sonnet. Follow CLAUDE.md. Read docs/STATUS.md, packages/domain/src/index.ts.

GOAL: packages/db — Prisma 6.19.3 (pinned in Prompt 0; use client extensions, not $use middleware) schema for PostgreSQL 16, migrations, seed, company-scope extension.

CONVENTIONS: id uuid default uuid(); createdAt, updatedAt; companyId FK on every business table; money Decimal @db.Decimal(18,4); qty/rates @db.Decimal(18,6).

MODELS:
Company(legalNameEn, legalNameAr, trn, tin?, tradeLicenseNo, emirate, addressEn, addressAr, baseCurrency 'AED', fiscalYearStartMonth, logoFileId?, einvoiceEnabled, einvoiceFrom?, settings Json)
Branch(code, nameEn, nameAr, address, emirate)
User(email unique per company, nameEn, nameAr?, passwordHash, mfaSecret?, isActive, locale en|ar, lastLoginAt, failedLogins, lockedUntil?)
Role(name, permissions String[]); UserRole(userId, roleId)
Session(userId, deviceId, refreshTokenHash, expiresAt, revokedAt?, ip, userAgent)
Device(name, kind SERVER|WORKSTATION, fingerprint, lastSeenAt, appVersion, revokedAt?)
Account(code, nameEn, nameAr, type ASSET|LIABILITY|EQUITY|INCOME|EXPENSE, subtype?, isControl, parentId?, isActive)
Period(start, end, status OPEN|LOCKED)
TaxCode(code, rate, labelEn, labelAr, outputAccountId, inputAccountId?, effectiveFrom, effectiveTo?, isActive)
Customer(code, nameEn, nameAr, trn?, email, phone, addressEn, addressAr, emirate?, country, currency, paymentTermsDays, creditLimit?, receivableAccountId)
Item(sku, nameEn, nameAr, unit, salePrice, taxCodeId, revenueAccountId, isActive)
NumberSequence(docType, pattern, nextValue BigInt, year?) unique(companyId, docType, year)
Quote + QuoteLine (revision, status DRAFT|SENT|ACCEPTED|REJECTED|EXPIRED)
Invoice(branchId?, number? unique(companyId, number), customerId, status, settlementStatus, deliveryStatus, einvoiceStatus, issueDate?, supplyDate?, dueDate, currency, fxRate, subtotal, discountTotal, taxTotal, total, totalAed, amountPaid, notes, terms, version Int, issuedAt?, issuedById?, legacyRef?, snapshotId?)
InvoiceLine(invoiceId, lineNo, itemId?, description, qty, unitPrice, discountPct, discountAmt, taxCodeId, net, tax, gross, accountId)
CreditNote + CreditNoteLine (invoiceId, reason, same totals/status fields)
Payment(number, customerId, date, method CASH|BANK|CARD|CHEQUE, bankAccountId, amount, currency, fxRate, unallocated, reference)
Allocation(paymentId, invoiceId?, creditNoteId?, amount, date)
Journal(number, date, source INVOICE|CREDIT_NOTE|PAYMENT|MANUAL|REVERSAL|BILL|PAYROLL, sourceId, memo, postedAt, reversalOfId?)
JournalLine(journalId, accountId, debit, credit, branchId?, description)
IssueSnapshot(docType, docId, payload Json, sha256, templateVersion)
Document(docType, docId, snapshotId, kind PDF|EINVOICE_XML, language en|ar|bi, path, sha256, bytes)
IdempotencyKey(key, userId, route, requestHash, responseJson) unique(companyId, key)
Outbox(topic, payload Json, status PENDING|PROCESSING|DONE|FAILED, attempts, nextAttemptAt, leaseUntil?, lastError?, external Boolean)
AuditEvent(userId?, action, entity, entityId, before Json?, after Json?, reason?, ip?, at)
SyncState(enabled, lastSeqSent BigInt, lastAckAt?)
ChangeLog(seq BigInt autoincrement, companyId, entity, entityId, op, data Json, at)
License(licenseKey, payload Json, seats, modules String[], expiresAt?, lastValidatedAt?, graceUntil?)
BackupRecord(path, sha256, sizeBytes, kind HOURLY|DAILY|MONTHLY|MANUAL, target LOCAL|FOLDER|CLOUD, status, at)
Indexes: (companyId, lookup field) everywhere; Invoice(companyId, status, issueDate); Journal(companyId, date); ChangeLog(companyId, seq).

RAW SQL MIGRATION (after prisma migrate):
- deferrable constraint trigger on JournalLine: per journal sum(debit) = sum(credit) at commit.
- trigger blocks UPDATE on Invoice/CreditNote when status <> 'DRAFT' except settlementStatus, deliveryStatus, einvoiceStatus, amountPaid, updatedAt.
- trigger blocks JournalLine insert/update when journal date falls in a LOCKED period.
- triggers append ChangeLog rows on all business tables (for sync).
- app role ddinvoice_app: no UPDATE/DELETE on AuditEvent.

SEED (packages/db/src/seed.ts): fictional 'Demo Trading LLC'; UAE chart of accounts: 1000 Cash, 1100 Bank, 1200 AR control, 1300 VAT Input, 1310 VAT RC Input, 1400 Inventory, 1450 GRNI, 2000 AP control, 2100 VAT Output, 2110 VAT RC Output, 2200 Salaries payable, 3000 Capital, 3100 Retained earnings, 4000 Sales, 4100 Services, 5000 COGS, 6000-6900 expenses; tax codes SR/ZR/EX/RC/OOS; sequences INV, CN, RCT, JV, QT; roles owner, accountant, sales, auditor with permission strings from packages/contracts/src/permissions.ts (create it: resource.action list); admin admin@demo.local with random password printed once.

SCOPE: packages/db/src/scope.ts Prisma client extension: scoped models require companyId in where/data, else throw.

TESTS: vitest globalSetup boots temp PostgreSQL via embedded-postgres (Windows binaries) on a random port. Assert: unbalanced journal rejected; issued invoice edit rejected; locked-period posting rejected; audit delete rejected; scope extension throws without companyId.

VERIFY: pnpm --filter @ddinvoice/db exec prisma validate; pnpm --filter @ddinvoice/db test.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 3 — Local API (apps/server)

Model: Haiku. The schema and rules are fixed, so this is standard NestJS work.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, packages/db/prisma/schema.prisma, packages/domain/src/index.ts, packages/contracts/src/*.

GOAL: apps/server NestJS Local API over HTTPS. OpenAPI at /api/docs in dev only.

CONFIG: src/config.ts reads %PROGRAMDATA%\DDInvoice\server.json {port 47820, dbUrl, dataDir, certPath, keyPath, companyId}; Zod-validated; dev fallback .env.local.

MODULES: auth, users, roles, companies, branches, accounts, periods, tax-codes, sequences, customers, items, quotes, invoices, credit-notes, payments, journals, documents, audit, health, system.
AUTH: POST /auth/login {email, password, deviceId} -> access JWT 15 min (EdDSA via jose, key in dataDir) + rotating refresh 30 days (hash in Session); POST /auth/refresh; POST /auth/logout; GET /auth/me. argon2id; lockout after 5 fails for 15 min; optional TOTP (otplib).
GUARDS: JwtGuard, PermissionGuard @Perm('invoice.issue'), company from token only. @nestjs/throttler.
IDEMPOTENCY: interceptor on all POST/PATCH commands; Idempotency-Key required; same key + same body hash -> stored response; same key + different body -> 409 IDEMPOTENCY_CONFLICT.
INVOICES:
- POST /invoices (draft); PATCH /invoices/:id (draft only, If-Match version); DELETE draft.
- POST /invoices/:id/issue in ONE Serializable transaction (retry 3x on 40001): SELECT NumberSequence FOR UPDATE, allocate number; recalc with domain.calcDocument (ignore client totals); check period open; write IssueSnapshot (payload + sha256); status ISSUED; insert balanced journal; insert Outbox document.render, plus einvoice.submit when company e-invoicing applies; AuditEvent. Return issued invoice.
- POST /invoices/:id/mark-sent.
- GET /invoices: cursor pagination, filters (status, settlement, customer, date range, search number/name), sort.
QUOTES: draft, revise, send, accept -> convert to invoice draft.
CREDIT NOTES: draft against issued invoice; issue with same pattern; reduces open balance.
PAYMENTS: POST /payments (posts journal), POST /payments/:id/allocate, POST /payments/:id/reverse.
JOURNALS: manual JV draft/post (permission journal.post); reverse.
ERRORS: global filter -> ApiError {code, message, fields?}; other companies' records always 404.
AUDIT: interceptor writes AuditEvent for every command.
HEALTH: GET /health {status, db, version, time, diskFreeGb}; GET /system/version {api, minClient}.
WORKER: src/worker.ts polls Outbox every 2s, lease 60s, exponential backoff, max 10 attempts, handler registry (stub handlers now; render in Prompt 6, einvoice in Prompt 11).
CLIENT: generate typed client from OpenAPI into packages/contracts/src/client (openapi-typescript + openapi-fetch); script pnpm gen:client.

TESTS (vitest + supertest + embedded-postgres): login, refresh rotation, lockout; permission denied; cross-company access 404; draft -> issue creates number + journal + snapshot + outbox; 20 parallel issues on 20 drafts -> 20 unique consecutive numbers; same Idempotency-Key twice -> one invoice; issue in locked period fails; credit note reduces balance; partial then full payment updates settlementStatus; overpayment -> unallocated amount; quote -> invoice conversion.

VERIFY: pnpm --filter @ddinvoice/server test && pnpm --filter @ddinvoice/server build.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 4 — Server runtime: PostgreSQL, Windows services, TLS, pairing

Model: Sonnet. Makes the main PC run unattended and lets workstations find it safely.

```text
MODEL: Sonnet. Follow CLAUDE.md. Read docs/STATUS.md, apps/server/src/config.ts, apps/server/package.json.

GOAL: A Windows PC runs the server role unattended.

1 POSTGRES: tools/scripts/fetch-postgres.ts downloads pinned PostgreSQL 16 Windows x64 binaries zip, checks sha256, extracts to vendor/pgsql (gitignored). Init: initdb -D %PROGRAMDATA%\DDInvoice\pgdata --auth=scram-sha-256 --encoding=UTF8. postgresql.conf: listen_addresses '127.0.0.1', port 47821, shared_buffers 256MB. pg_hba: host 127.0.0.1/32 scram only. Create roles ddinvoice_owner (migrations) and ddinvoice_app (least privilege), database ddinvoice. Random 32-byte passwords stored DPAPI-encrypted (PowerShell ConvertFrom-SecureString, LocalMachine scope) in %PROGRAMDATA%\DDInvoice\secrets.bin; ACL SYSTEM + Administrators only.
2 RUNTIME: esbuild bundles apps/server to dist/server.cjs and dist/worker.cjs; copy Prisma Windows query engine; tools/scripts/fetch-node.ts vendors pinned node.exe 22 LTS (sha256) to vendor/node.
3 SERVICES: vendored WinSW 3 (pinned, sha256). Services DDInvoicePostgres, DDInvoiceApi, DDInvoiceWorker; delayed auto start; restart on failure 3x within 60s; Api and Worker depend on Postgres; logs %PROGRAMDATA%\DDInvoice\logs rotated 10MB x 10.
4 TLS: first setup generates local CA (10y) + server cert (2y, SAN = hostname, all LAN IPv4, localhost) with node-forge. Keys ACL-restricted. GET /pairing/ca returns CA cert; server screen shows its SHA-256 fingerprint.
5 DISCOVERY: bonjour-service advertises _ddinvoice._tcp on 47820 with TXT {companyId, name, version}. Manual host:port also supported.
6 PAIRING: server UI shows 6-digit code valid 10 min; POST /pairing {code, deviceName, fingerprint} registers Device and returns CA fingerprint; then normal login. Unpaired devices rejected on all routes except /pairing and /health.
7 FIREWALL: netsh advfirewall firewall add rule name='DDInvoice API' dir=in action=allow protocol=TCP localport=47820 profile=private,domain. Never open 47821.
8 SETUP CLI src/setup/cli.ts (elevated): install-server --company-name --admin-email [--no-service] [--data-dir] (steps 1,3,4,7 + prisma migrate deploy + seed chart of accounts/admin + write server.json); uninstall-server (keeps data unless --delete-data); status; migrate; rotate-cert.
9 UPGRADE SAFETY: before migrate deploy, pg_dump -Fc to dataDir\backups\pre-migrate-<version>.dump; on failure restore it and keep old version running; log result.

TESTS: unit tests for config, cert generation, pairing code expiry, unpaired rejection. tools/scripts/smoke-server.ps1: install-server --no-service into a temp data dir (process mode), GET /health = 200, pairing works, uninstall. Run it.

VERIFY: pnpm --filter @ddinvoice/server test; powershell -ExecutionPolicy Bypass -File tools/scripts/smoke-server.ps1.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 5 — Desktop app UI (apps/desktop)

Model: Haiku. Builds the screens on top of the typed API client.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, packages/contracts/src/client/*, packages/contracts/src/permissions.ts.

GOAL: Electron app: role setup, pairing, login, core sales and accounting screens, English + Arabic RTL.

STACK: electron-vite, React 18, React Router, Tailwind 3, shadcn/ui in packages/ui, TanStack Query 5, TanStack Table 8, React Hook Form + Zod, i18next, lucide-react, sonner. Fonts Inter + Noto Sans Arabic bundled (no CDN). Visual: neutral surfaces, navy text, cobalt primary, 14px body, compact density.

MAIN PROCESS (src/main): BrowserWindow with contextIsolation, sandbox, no nodeIntegration; CSP default-src 'self', connect-src only the paired server origin; block navigation and window.open (allowlisted links open in system browser); single-instance lock; tokens in userData via safeStorage; HTTPS agent pins server CA fingerprint from pairing. IPC handlers (Zod-validated): config.get/set, auth.storeTokens/clear, server.discover (bonjour browse 3s), server.pair, print.pdf, file.saveAs, app.version, setup.installServer (runs setup CLI elevated via PowerShell Start-Process -Verb RunAs).
PRELOAD: window.ddi typed API only.

FIRST-RUN WIZARD: 1 Language EN/AR. 2 Role: Main PC (server) | Workstation. 3a Server: company names EN/AR, TRN, emirate, admin email + password -> installServer -> show pairing code + CA fingerprint. 3b Workstation: discovered servers + manual address -> pairing code -> confirm fingerprint. 4 Login.

SHELL: left nav (Overview; Sales: Quotes, Invoices, Credit Notes, Receipts, Customers, Items; Accounting: Journals, Chart of Accounts, Periods; Reports placeholder; Settings: Company, Branches, Users & Roles, Tax Codes, Numbering, Devices, Backup, License). Top bar: company, branch, Ctrl+K command palette, connection badge (Connected | Server offline | Reconnecting), language toggle, user menu. Nav hidden by permission.

SCREENS:
- Overview: receivables outstanding, overdue, collected this month, drafts count; queues for drafts and overdue customers; every figure opens its filtered list.
- Invoice register: server-side pagination, saved views per user, column show/resize persisted, filters, multi-select, CSV export, side preview panel (archived PDF when issued). Separate chips: Document, Payment, Delivery, e-Invoice.
- Invoice editor: header (customer combobox + quick create, issue/supply/due dates, currency + rate, branch, terms, reference); keyboard line grid (Enter next cell, Tab, arrows, Ctrl+D duplicate line, Ctrl+Delete remove, multi-row paste from Excel); item autocomplete; live totals via @ddinvoice/domain (display only); autosave draft every 5s + Ctrl+S; inline field errors from ApiError.fields; Issue -> confirm dialog (totals, customer, 'number assigned on issue') -> POST issue with Idempotency-Key (uuid stored with draft until success).
- Credit note editor, Receipt with allocation grid, Customer workspace (balance, invoices, payments, statement), Items, Journals + manual JV, Accounts tree, Periods lock/unlock, Users & Roles permission matrix, Tax codes, Numbering patterns, Devices (revoke), Company settings (logo, bilingual names, TRN).

OFFLINE: when server unreachable show banner; read persisted query cache (@tanstack/query-persist-client to IndexedDB; exclude payroll and employee keys; max age 7 days); drafts editable and stored in main-process encrypted store (AES-256-GCM, key in safeStorage) labelled 'Unsynced draft'; issue/post buttons disabled; on reconnect upload drafts with version check, conflict dialog shows both values.

I18N: locales/en.json + ar.json complete; eslint-plugin-i18next no-literal-string on JSX; RTL mirrored layout; <bdi> around numbers, IDs, emails.
VERSION GATE: on connect GET /system/version; app < minClient -> blocking 'Update required' screen.

TESTS: vitest + Testing Library: grid keyboard, totals, permission-hidden nav; script checks en/ar key parity; Playwright _electron smoke against pnpm dev:server (embedded-postgres): login, create and issue invoice, number shown.

VERIFY: pnpm --filter @ddinvoice/desktop test && pnpm --filter @ddinvoice/desktop build.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 6 — Bilingual PDF documents

Model: Haiku. PDFs render on the server PC from the frozen snapshot, so reprints never change.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, apps/server/src/worker.ts, IssueSnapshot and Document models.

GOAL: Canonical English/Arabic/bilingual PDFs rendered by the worker from IssueSnapshot only.

RENDERER: puppeteer-core + pinned chrome-headless-shell win64 vendored by tools/scripts/fetch-chrome.ts (sha256). Worker keeps one browser, restarts it every 200 renders; JavaScript disabled in pages; request interception blocks all network; fonts via file:// from packages/documents/fonts (Noto Sans, Noto Sans Arabic, Noto Naskh Arabic).
TEMPLATES packages/documents/templates/v1: invoice, credit-note, receipt, quote, statement (.hbs) + partials header, parties, lines (thead repeats each page), totals, tax summary by code, bank details, footer 'Page X of Y'. Handlebars strict mode, no fs helpers. Languages: en, ar (dir=rtl), bi (paired labels e.g. 'Tax Invoice / فاتورة ضريبية').
UAE TAX INVOICE FIELDS: 'Tax Invoice' title; supplier name, address, TRN; customer name, address, TRN when registered; invoice number; issue date; supply date if different; per line description, qty, unit price, tax rate, tax amount; totals; VAT total in AED; currency and rate when not AED. Credit note adds original invoice reference and reason. Template version saved on snapshot.
HANDLER document.render: load snapshot (never live records) -> render -> write %dataDir%\documents\<yyyy>\<docType>\<number>-<lang>.pdf -> sha256 -> insert Document. Idempotent: skip when Document exists for same snapshot + lang. Failure -> outbox retry; UI shows 'PDF pending'.
API: GET /documents/:docType/:docId/pdf?lang= streams archived file (authz); POST /documents/preview renders draft with 'DRAFT / مسودة' watermark, not archived.
DESKTOP: Print (Ctrl+P) fetches archived PDF -> temp file -> hidden window -> system print dialog; Save as PDF; default language per customer preference.

TESTS: fixtures (simple, mixed tax, USD, 200 lines, long Arabic addresses) x en/ar/bi; 200-line PDF has >1 page and totals on last page; pdfjs-dist text extraction finds number, TRN, total; same snapshot twice -> one Document; changing company logo after issue leaves archived sha256 unchanged.

VERIFY: pnpm --filter @ddinvoice/server test -- documents; save fictional sample PDFs to docs/samples/.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 7 — Multi-PC, multi-user hardening

Model: Haiku. Proves several users on several PCs cannot corrupt the books.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md.

GOAL: Prove multi-PC, multi-user safety and close gaps.
1 Concurrency: optimistic locking (version + If-Match) on every draft PATCH; 409 VERSION_CONFLICT returns current record; desktop conflict dialog shows mine vs theirs per field.
2 Live updates: GET /events SSE stream per company; server pushes entity events (invoice.issued, payment.created, draft.updated) and presence ('<user> is editing <draft>'); desktop invalidates matching TanStack Query keys and shows presence badge.
3 Sessions: admin sees active sessions and devices; revoke kills refresh token and closes SSE; concurrent session counter ready for license seats (enforced in Prompt 8).
4 Server offline: desktop retries with backoff; pending commands keep their Idempotency-Key in local store and resend the same key on reconnect (no duplicates).
5 Version handshake: desktop < minClient -> 'Update required'; desktop newer than API -> 'Main PC needs update' screen.
6 Clock: server time is authoritative for issue dates; desktop warns when local clock skew > 5 min.
7 Load: tools/scripts/seed-volume.ts creates 100k invoices + payments; tools/scripts/load.ts runs 10 virtual users for 3 min (create drafts, issue, pay). Assert 0 duplicate numbers, all journals balanced (SQL), invoice list p95 < 1s.
8 Two-workstation e2e: Playwright launches 2 Electron instances against one server; simultaneous issue -> distinct numbers; both edit same draft -> second gets conflict dialog; SSE refresh shows new invoice on the other instance within 3s.

VERIFY: pnpm test; node tools/scripts/load.ts; write p95 and duplicate count into docs/STATUS.md.
EXPECTED OUTPUT (max 8 lines, include p95 and duplicate count).
```

## Prompt 8 — Backup, restore, health, licensing, support bundle

Model: Haiku. The books live on a customer PC, so backups and safe restore are mandatory before any pilot.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, apps/server/src/setup/*.

GOAL: Backup/restore, health screen, licensing, support bundle, data export.
BACKUP (worker, node-cron): hourly pg_dump -Fc + documents delta -> AES-256-GCM encrypt (key in secrets.bin; a printable recovery key is shown once at install) -> %dataDir%\backups\hourly (keep 48), daily (keep 30), monthly (keep 12). Extra target in Settings: folder/USB/network path (daily copy); cloud target added in Prompt 10. Verify each backup with pg_restore --list + sha256 into BackupRecord. All workstations show a warning banner when last good backup > 26h.
RESTORE (owner only, on server PC): pick file (+ recovery key if from another PC) -> stop worker -> restore into ddinvoice_restore -> verify -> swap databases -> start in RECOVERY MODE: Outbox rows with external=true (einvoice, sync, email) stay paused until owner reviews the pending list and clicks Release. New-PC recovery: setup CLI install-server --restore <file>.
HEALTH (Settings > Server health): service states, DB size, disk free (warn < 10 GB), last backup, worker queue depth and failed jobs (retry/dismiss), certificate expiry, versions, connected devices.
LICENSING: Ed25519-signed license file; public key embedded in server; private key never in repo. tools/license/issue-license.ts reads LICENSE_SIGNING_KEY from env (vendor use only). Payload {companyId, companyName, trn, seats, modules [sales, purchases, banking, reports, payroll, einvoice, sync], expiresAt?, issuedAt}. Server enforces concurrent-session seats and modules (API guards + nav). Optional online check (endpoint in Prompt 10); offline grace 30 days; expired -> read-only mode (view, print, export only). Install creates a 30-day trial: 3 seats, all modules.
SUPPORT BUNDLE (Settings > Help): zip of versions, health JSON, migration status, logs redacted (tokens, passwords, emails, customer names, IBANs). Never includes the database.
DATA EXPORT: full company export (CSV per table + documents folder + manifest with sha256) for offboarding.

TESTS: backup -> restore round trip keeps row counts and trial balance equal; restore leaves external outbox paused; tampered license rejected; seat limit enforced; expired license read-only; support bundle redaction.

VERIFY: pnpm test.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 9 — Installer, auto-update, release pipeline

Model: Sonnet. One signed installer covers both roles; the server PC always updates first.

```text
MODEL: Sonnet. Follow CLAUDE.md. Read docs/STATUS.md, apps/desktop/electron.vite.config.*, apps/server/src/setup/cli.ts.

GOAL: One signed Windows installer for both roles + auto-update + release workflow.
electron-builder (pinned) NSIS: appId ae.ddotsmedia.ddinvoice, productName DDInvoice, perMachine true, allowElevation, oneClick false, custom NSH page 'Install type: Main PC (server) / Workstation' writing %PROGRAMDATA%\DDInvoice\role.json; silent switch /ROLE=server|workstation. extraResources: server dist, vendor/node, vendor/pgsql, vendor/winsw, vendor/chrome-headless-shell, packages/documents templates + fonts. Workstation install skips server resources at runtime (not registered).
Server role: installer runs setup CLI install-server --deferred (services registered; company configured in the app wizard). Uninstall stops and removes services and KEEPS %PROGRAMDATA%\DDInvoice data unless the user ticks 'Delete all company data' and confirms twice.
AUTO-UPDATE: electron-updater (GitHub provider, owner ddotsmedia, repo ddinvoice-desktop), channels latest and pilot; verify publisher signature; download in background; install only on user action or app quit, never while unsynced drafts or an open payroll run exist. Server PC: after update, setup CLI migrate runs (pre-migrate backup from Prompt 4) then services restart. Workstations stay blocked by the version gate until the server is updated. Updater refuses downgrades (an older exe cannot roll back the DB).
SIGNING: Azure Trusted Signing via electron-builder azureSignOptions using GitHub Secrets AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SIGNING_ACCOUNT, AZURE_CERT_PROFILE. Secrets missing -> build unsigned with a warning, do not fail.
CI: extend .github/workflows/release.yml from Prompt 0b (pilot on green main, promote via workflow_dispatch) with these build steps: windows-latest; pnpm install --frozen-lockfile; lint, typecheck, test; fetch vendors with sha256 check; build; sign; create draft GitHub Release with latest.yml. Keep ci.yml.
SMOKE tools/scripts/smoke-installer.ps1 (runs in CI): silent install /S /ROLE=server to temp, services running, /health 200, silent uninstall, data folder still present.

VERIFY: pnpm --filter @ddinvoice/desktop dist (local, unsigned) -> release/DDInvoice-Setup-<version>.exe; run smoke-installer.ps1 if elevation available, else document Windows Sandbox steps in docs/TESTING.md.
EXPECTED OUTPUT (max 8 lines, include installer size MB).
```

## Prompt 10 — Optional cloud sync (one-way)

Model: Sonnet. The only prompt that deploys anything, and only through GitHub Actions to a new VPS.

```text
MODEL: Sonnet. Follow CLAUDE.md; rule 12 exception: deploy ONLY via the GitHub Actions workflow below. Read docs/STATUS.md, ChangeLog and SyncState models.

GOAL: Optional one-way sync server PC -> cloud; cloud backup storage; read-only cloud API for ddinvoice.com; license check endpoint.

CLOUD apps/cloud-sync (NestJS + PostgreSQL 16 + S3-compatible storage):
- Tenancy: registry table companies; desktop company registers with its license key -> syncClientId + HMAC secret. One PostgreSQL schema per company (cs_<companyId>) with mirror tables generated from packages/db models; separate DB role per schema.
- POST /v1/sync/batch {companyId, fromSeq, toSeq, changes[]}: gzip, HMAC-SHA256 over body + timestamp (+-5 min) + nonce (replay table); apply in one transaction in seq order; seq <= lastApplied ignored; gap -> 409 SEQ_GAP; returns ackSeq.
- GET /v1/sync/state; POST /v1/backups/upload-url (pre-signed PUT, per-company prefix, files already client-encrypted); GET /v1/backups; retention 30 daily.
- GET /v1/license/check.
- Read-only API /v1/ro/:companyId/(invoices|customers|payments|summary): JWT verified against JWKS_URL env (ddinvoice.com identity), membership table maps user -> company. No write endpoints for desktop-mode companies.
DESKTOP SERVER: worker job sync.push every 60s when SyncState.enabled: ChangeLog rows > lastSeqSent in batches of 500 -> sign -> send -> store ack; exponential backoff; external=true outbox. Excluded by default: payroll, employee, bank-detail tables (owner can opt in). Settings > Cloud sync: register, enable/pause, last sync, lag, 'Upload backups to cloud' toggle (uses Prompt 8 encrypted files).

DEPLOY:
- apps/cloud-sync/Dockerfile: node:22-alpine multi-stage, non-root, healthcheck.
- docker-compose.cloud.yml: project name ddinvoice-cs; services api (127.0.0.1:47900) and postgres (no host port, named volume).
- .github/workflows/deploy-cloud-sync.yml on push to main touching apps/cloud-sync/**: test -> build -> push ghcr.io/ddotsmedia/ddinvoice-cloud-sync:<sha> -> SSH (deploy job skipped, not failed, when secret VPS_HOST is empty) with secrets VPS_HOST, VPS_USER, VPS_SSH_KEY to the NEW VPS (never srv988590) -> in /opt/ddinvoice-cloud-sync run ops/precheck.sh: port 47900 free or owned by ddinvoice-cs, docker ps shows no name collisions, nginx -t passes, disk free > 10 GB, else abort -> docker compose -p ddinvoice-cs pull && up -d -> /health 200 within 60s else redeploy previous tag -> ops/postcheck.sh curls every URL in secret OTHER_SITES and fails the job if any is not 200.
- ops/nginx/sync.ddinvoice.com.conf template (HTTPS, proxy to 127.0.0.1:47900); manual install steps in docs/DEPLOY.md, never applied by CI.
- Never docker prune, never touch other compose projects, never restart nginx (reload only, documented, manual).

TESTS: local e2e: docker compose -f docker-compose.cloud.yml up -d + desktop server with embedded-postgres; create 100 invoices -> mirror counts and totals equal; replayed batch ignored; bad signature 401; gap rejected until filled; disabling sync stops pushes; read-only API denies other company. Then docker compose down (this project only).

VERIFY: pnpm test; local e2e script tools/scripts/sync-e2e.ps1.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 11 — UAE e-invoicing (ASP adapter)

Model: Sonnet. Built against a mock ASP; going live needs your chosen ASP's spec and sandbox. SMEs (under AED 50M revenue) must appoint an ASP by 31 March 2027 and go live on 1 July 2027.

```text
MODEL: Sonnet. Follow CLAUDE.md. Read docs/STATUS.md, IssueSnapshot/Outbox models, packages/domain/src/tax.ts.

GOAL: UAE e-invoicing (PINT-AE through an Accredited Service Provider) for outbound invoices and credit notes and inbound supplier invoices. Provider-agnostic.
PACKAGE packages/einvoice:
- model.ts: EInvoice built ONLY from IssueSnapshot: seller (legal name, TRN, TIN, trade licence, structured address), buyer (same), type 380 invoice / 381 credit note, issue date, supply date, document currency, tax currency AED, lines (qty, unit code, price, net, tax category S/Z/E/AE/O + rate), allowances/charges, tax breakdown per category, totals, payment terms and means, preceding invoice reference for credit notes.
- pint-ae.ts: model -> UBL 2.1 XML (xmlbuilder2). All customization/profile IDs and code lists in constants.ts marked VERIFY_WITH_ASP; mappingVersion 'v1'.
- validate.ts: mandatory fields, TRN 15 digits, totals reconcile, category/rate consistency -> field errors. Desktop editor shows them BEFORE issue when e-invoicing applies.
- adapter.ts: interface AspAdapter {submit(xml, opId), getStatus(providerRef | opId), fetchInbound(since), ackInbound(id), testConnection()}. MockAspAdapter (deterministic: accepts; rejects buyer TRN '000000000000000'; timeout mode). HttpAspAdapter skeleton (base URL, OAuth2 client credentials from secrets.bin, retries) configured per company in Settings > e-Invoicing (provider, endpoint, credentials, test/live, effective date).
WORKER einvoice.submit (external=true): build -> validate -> store XML Document with sha256 -> submit with opId = snapshot sha256 -> SUBMITTED -> poll getStatus every 5 min until ACCEPTED or REJECTED (server PC is behind NAT: polling, no inbound webhooks). Timeout or unknown result -> query by opId before any resubmit (never submit twice). REJECTED keeps number and journal; show reason; correction = credit note + new invoice, or resubmit only where the ASP allows.
INBOUND job every 15 min: fetch -> store XML -> InboundDocument row -> parsed draft Supplier Bill once Prompt 12 exists (until then list only) -> user review.
UI: e-Invoice chip + detail panel (submitted at, provider ref, errors, XML download), queue of pending/rejected, Settings page with Test connection. Invoices dated before company einvoiceFrom = NOT_REQUIRED.

TESTS: golden XML files for SR, ZR, EX, RC, USD, credit note; validation errors; mock accept / reject / timeout; duplicate submit prevented; restored backup never resubmits ACCEPTED (Prompt 8 recovery mode).

VERIFY: pnpm test.
EXPECTED OUTPUT (max 8 lines).
```

When your ASP is chosen, run one Haiku session: give it the ASP's API spec and PINT-AE profile, and ask it to update `constants.ts` and `HttpAspAdapter`, then run the golden tests against the sandbox.

## Prompt 12 — Purchases, expenses, supplier payments

Model: Haiku. Mirrors the invoice pattern on the supplier side.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, schema.prisma, apps/server/src/invoices/* (pattern to copy).

GOAL: Suppliers, purchase orders, goods receipts, supplier bills, debit notes, supplier payments, expenses. License module 'purchases'.
SCHEMA ADD: Supplier; PurchaseOrder + Line (DRAFT|APPROVED|PARTIAL|RECEIVED|CLOSED); GoodsReceipt + Line; SupplierBill + Line (supplierInvoiceNo unique per supplier, issueDate, dueDate, status, settlement); DebitNote + Line; SupplierPayment + BillAllocation; Expense (category, paidBy, reimbursable, receipt); Attachment (path, sha256, mime pdf/jpg/png, max 20 MB). Sequences PO, GRN, BILL, DN, SPAY, EXP. Optional inventory flag: StockMovement (item, qty, unitCost, source) with weighted-average cost.
POSTING: bill line Dr expense/inventory/GRNI + Dr VAT Input / Cr AP; RC bill Dr VAT Input RC / Cr VAT Output RC; goods receipt (inventory on) Dr Inventory / Cr GRNI; debit note reverses; payment Dr AP / Cr Bank.
CONTROLS: 3-way match bill vs PO vs received qty with tolerances (qty 0%, price 2%, Settings); exceptions need purchase.approve-exception. Duplicate bill warning: same supplier + supplierInvoiceNo, or same supplier + amount + date +-3 days. Approval thresholds per role (Settings). Payments allocate to bills; partial; overpayment = supplier advance.
INBOUND e-invoices from Prompt 11 become draft bills with supplier match by TRN.
UI: Purchases nav (Suppliers, POs, Receipts, Bills, Debit Notes, Payments, Expenses); bill editor reuses the line grid; attachment side panel; AP aging widget on Overview.

TESTS: PO of 10 units received 6 + 4, billed in two bills, 2 returned via debit note -> quantities, AP, GRNI agree and all journals balance; duplicate detection; approval required above threshold; RC bill journal; inbound e-invoice -> draft bill.

VERIFY: pnpm test; e2e create -> approve -> receive -> bill -> pay.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 13 — Banking and reconciliation

Model: Haiku. Statement import first; no direct bank feeds promised.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md.

GOAL: Bank accounts, statement import, suggested matching, reconciliation. License module 'banking'.
SCHEMA ADD: BankAccount (gl accountId, bankName, iban, currency); BankStatement (file sha256, from, to, opening, closing); BankLine (date, valueDate, description, reference, amount signed, balance?, hash, status UNMATCHED|SUGGESTED|MATCHED|EXCLUDED); BankMatch (bankLineId, entityType PAYMENT|SUPPLIER_PAYMENT|JOURNAL, entityId, amount); Reconciliation (bankAccountId, statementDate, statementBalance, bookBalance, status OPEN|COMPLETED, completedBy, completedAt).
IMPORT: CSV and XLSX (exceljs) with column-mapping wizard; mapping saved per bank account; generic presets for common UAE bank exports (user confirms columns); date format detection; duplicate lines skipped by hash(date, amount, reference, description); preview before commit; MT940 parser.
MATCHING: scored suggestions with reason text: exact amount + reference contains document number (100); exact amount + date +-3 days (80); one line = sum of several payments; several lines = one payment. Actions from a line: receive customer payment, supplier payment, bank fee expense (Dr Bank charges / Cr Bank), transfer between accounts, exclude.
RECONCILE: statement balance, cleared items, difference; Complete allowed only at 0.00 difference with permission bank.reconcile; completed items locked; unmatch needs reopen permission.
UI: Banking nav (Accounts, Import, Match, Reconciliations); Overview queue 'Unmatched bank lines'.

TESTS: duplicate import skipped; grouped match; fee line creates balanced expense journal; nonzero difference blocks completion; completed match cannot be undone without permission.

VERIFY: pnpm test.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 14 — Reports and VAT return summary

Model: Haiku. Every report is computed from posted journals only, with drill-down to the source document.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md.

GOAL: Financial reports with drill-down and PDF/XLSX export. License module 'reports'.
REPORTS (apps/server/src/reports, parameterized SQL, company-scoped): Trial Balance; General Ledger (account, date range); Profit & Loss (period + comparison); Balance Sheet (as of); AR Aging and AP Aging by due date (current, 1-30, 31-60, 61-90, 90+); customer and supplier statements; sales by customer and by item; cash summary from bank accounts.
VAT RETURN SUMMARY in FTA VAT 201 layout: Box 1a-1g standard-rated supplies by emirate (Abu Dhabi, Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah; emirate from branch, else company); Box 2 tourist refunds; Box 3 supplies subject to reverse charge; Box 4 zero-rated; Box 5 exempt; Box 6 goods imported; Box 7 import adjustments; Box 8 totals; Box 9 standard-rated expenses; Box 10 reverse-charge expenses; Box 11 totals; Box 12-14 total due, recoverable, net payable. Every box drills to its documents. Mapping in reports/vat201.map.ts marked VERIFY_WITH_ACCOUNTANT. This is a working summary for filing on the FTA portal, not a submission.
UI: Reports nav; parameter bar (period, branch, comparison); expandable rows; click any amount -> source list -> document. Export PDF (documents renderer, report template) and XLSX (exceljs); header shows company, period, basis, filters, generated time.
PERFORMANCE: TB and P&L < 2s on the 100k-invoice seed; if slower add MonthlyAccountBalance table updated inside the posting transaction.

TESTS: TB debits = credits; P&L net = change in retained earnings; Balance Sheet A = L + E; AR aging total = AR control account balance; VAT 201 box totals equal tax journal totals for fixtures.

VERIFY: pnpm test.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 15 — Payroll and WPS (run later)

Model: Sonnet. Run only after a payroll owner gives you the salary components in use, the bank's WPS SIF specification and an anonymized sample payroll. Put those files in `docs/payroll-inputs/` first.

```text
MODEL: Sonnet. Follow CLAUDE.md. Read docs/STATUS.md and every file in docs/payroll-inputs/ (authoritative; where they conflict with this prompt, follow them and log it).

GOAL: Payroll with WPS SIF export. License module 'payroll'.
SCHEMA ADD: Employee (empNo, names EN/AR, molPersonalId, labourCardNo?, emiratesId and iban encrypted with pgcrypto using key from secrets.bin, bankRoutingCode, department, branch, joinDate, status, visaExpiry, passportExpiry); Contract (effectiveFrom/To, basic, components [{code, amount, type FIXED|VARIABLE, wpsCovered}]); LeaveType, LeaveRequest, LeaveBalance; AttendanceInput (daysWorked, overtimeHours by type); PayrollRun (period, version, status DRAFT|CALCULATED|APPROVED|EXPORTED|SUBMITTED|ACCEPTED|PARTIAL_REJECT|SETTLED, preparedBy, approvedBy); PayrollLine (components, gross, deductions, net, wpsFixed, wpsVariable, nonWps, held, daysPaid, leaveDays); PayrollExport (path, sha256, mappingVersion, recordCount, controlTotal); PayrollEvent.
CALC packages/domain/payroll.ts: proration method (calendar or 30-day, setting), unpaid leave deduction, overtime multipliers, loan/advance deductions, all from a PayrollPolicy config; end-of-service gratuity as an estimate report only. Default policy values marked VERIFY_WITH_PAYROLL_OWNER.
WPS packages/payroll-wps/sif.ts: SIF employee (EDR) and control (SCR) records per the bank spec in docs/payroll-inputs; mapping JSON per bank; filename pattern configurable. Pre-export reconciliation per employee: net = wpsFixed + wpsVariable + nonWps + held. Block export on any unexplained difference, invalid personal ID length, invalid IBAN (mod-97), negative values, record count or control total mismatch; show exact employee and component. Export is immutable; re-download returns identical bytes; changes need a new run version.
APPROVAL: preparer and approver must differ; edits after approval create a new version needing reapproval. Approval posts Dr salary expense per component/department / Cr salaries payable. Settlement only from bank reconciliation match: Dr salaries payable / Cr Bank. Generating a file never marks salaries paid.
PERMISSIONS: payroll.view, payroll.prepare, payroll.approve, payroll.export, employee.bank.edit (all separate). Payroll data excluded from offline cache and cloud sync by default.
UI: People nav (Employees, Leave, Payroll runs: review grid with change vs previous run, exceptions panel that blocks export; document expiry reminders at 90/60/30 days).

TESTS: proration, leave, overtime fixtures from docs/payroll-inputs; SIF control totals; mismatch blocks export; identical bytes on re-download; preparer cannot approve; payroll journal balanced; settlement only after bank match.

VERIFY: pnpm test.
EXPECTED OUTPUT (max 8 lines).
```

## Prompt 16 — Final acceptance gate

Model: Haiku. Run before the first pilot company, and again before each release.

```text
MODEL: Haiku. Follow CLAUDE.md. Read docs/STATUS.md, docs/ARCHITECTURE.md.

GOAL: Run release gates, fix failures with minimal diffs, write docs/ACCEPTANCE.md with PASS/FAIL + evidence (command, result) per gate.
GATES:
1 Isolation: two companies on one cloud-sync instance cannot read or sync each other (401/404); a workstation paired to company A cannot pair or log in to company B's server.
2 Financial integrity: SQL check all journals balanced; AR/AP control accounts = subledgers; 50 parallel issues -> unique gapless numbers; retry with same key -> one document.
3 Documents: archived PDF and e-invoice XML sha256 unchanged after customer, logo or template change.
4 e-Invoice: mock timeout, reject, duplicate and out-of-order status paths keep the invoice and never double submit.
5 Purchasing: PO partial receipt / split bill / return scenario reconciles.
6 Payroll (if built): zero unexplained differences; file generation does not mark paid.
7 Recovery: backup -> wipe test DB -> restore -> trial balance equal; external outbox paused until Release.
8 Offline: server stopped -> workstation banner, drafts saved locally, issue disabled; reconnect uploads drafts with no duplicates.
9 Localization: en/ar key parity 100%; Playwright RTL screenshots of overview, invoice editor, register into docs/screens/; Arabic PDF text extraction matches.
10 Performance on reference PC (Core i5, 8 GB RAM, SSD): app ready < 3s; register p95 < 1s at 100k invoices; 10-line PDF < 3s; 200-line PDF renders all rows.
11 Security: electronegativity scan has no high findings; pnpm audit --prod has no high/critical; gitleaks finds no secrets; extracted installer resources contain no private keys or passwords.
12 Installer: server + 2 workstations install; update server then workstations; uninstall keeps data.
Automate gates 1-5, 7, 9, 11 in tools/scripts/acceptance.ts. Gates 6, 8, 10, 12: exact manual checklist in docs/ACCEPTANCE.md.
Repeat fix -> rerun until all automated gates pass.

VERIFY: node tools/scripts/acceptance.ts.
EXPECTED OUTPUT (max 12 lines): gate -> PASS/FAIL.
```

After all gates pass: pilot with one real company for one full month-end close, then the first VAT return, before selling to the second customer.
