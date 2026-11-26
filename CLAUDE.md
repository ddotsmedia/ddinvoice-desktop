# DDInvoice Desktop — Rules

1. Automation: never ask questions; choose the option most consistent with this file; log it in docs/DECISIONS.md (date | decision | one-line reason).
2. Tokens: minimal output; never dump files; diffs not rewrites; read only files needed; no re-explaining.
3. Money: never JS number for money/qty/rates. decimal.js in domain; Prisma Decimal = PostgreSQL NUMERIC(18,4) amounts, NUMERIC(18,6) qty/rates; JSON carries decimals as strings. AED rounding 2dp half-up per packages/domain/src/rounding.ts.
4. Authority: only apps/server allocates numbers, posts journals, changes issued docs. Desktop never connects to the DB.
5. Issued records are immutable; corrections only via credit note / reversal journal.
6. Every command endpoint: auth guard, permission guard, Zod validation, Idempotency-Key header, one DB transaction, audit event.
7. Every posted journal balances: domain check + DB constraint trigger.
8. Every business table has companyId; every query filters by it (Prisma extension enforces).
9. Electron: contextIsolation true, nodeIntegration false, sandbox true, strict CSP, preload exposes a typed minimal API; secrets via safeStorage; no secrets in repo, installer or logs.
10. i18n: all UI text via i18next keys (en, ar); RTL via dir attribute; numbers/IDs/emails wrapped in <bdi>.
11. Tests: vitest; every feature adds tests; pnpm test must pass before commit.
12. Local only: never SSH, never touch any VPS, never run destructive commands (rm -rf outside repo, git reset --hard, git push --force, docker prune, dropdb on non-test DBs). Deployment only via GitHub Actions in Prompt 10.
13. End of every prompt: pnpm lint && pnpm typecheck && pnpm test (stop and fix if any fail); update docs/STATUS.md; git add -A; git commit -m "<phase>: <summary>"; git pull --rebase origin main; git push origin main. Never --force, never push with failing tests, never rewrite history. After push run gh run watch on the CI run; if CI fails, fix, commit, push again until green.
15. Versioning: apps/desktop/package.json version is the product version (semver). Bump minor at the end of each numbered prompt, patch for fixes. Server and desktop share the version.
14. Pin exact versions; commit pnpm-lock.yaml.
