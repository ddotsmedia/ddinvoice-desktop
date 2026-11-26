# Status
Phase 1 scaffold: done (v0.1.0). Phase 2 CI/release: done. Phase 4 db schema: CI fixed.
- CI: .github/workflows/ci.yml (lint, typecheck, test, build; db job on linux postgres)
- Release: .github/workflows/release.yml (CI success on main -> pilot prerelease; dispatch -> promote)
- Deploy flow: docs/DEPLOY.md; branch protection payload docs/protection.json
- Key: CLAUDE.md, docs/ARCHITECTURE.md, packages/domain/src/rounding.ts, packages/contracts/src/errors.ts, packages/db/prisma/schema.prisma
- Fixed CI: pnpm 12 blocked @embedded-postgres/linux-x64 build script; allowed in pnpm-workspace.yaml.
Next: auth/users/permissions, Prisma company extension, HTTPS, Postgres service.
Known: server HTTP only; cloud-sync empty; release pilot ships source zip only (no installer); GitHub reports 114 dependency vulnerabilities (dependabot).
