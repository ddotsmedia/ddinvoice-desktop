# Status
Phase 1 scaffold: done.
- Monorepo: apps/{desktop,server,cloud-sync}, packages/{domain,contracts,db,ui,documents}
- Key: CLAUDE.md, docs/ARCHITECTURE.md, packages/domain/src/rounding.ts, packages/contracts/src/errors.ts, packages/db/prisma/schema.prisma
- CI: .github/workflows/ci.yml
Next: auth/users/permissions, Prisma company extension, HTTPS, Postgres service.
Known: server HTTP only; cloud-sync empty; tailwind/shadcn minimal; no journal trigger yet.
