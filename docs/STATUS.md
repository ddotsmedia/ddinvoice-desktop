# Status
Phase 1 scaffold: done (v0.1.0).
Phase 2 CI/release: done.
- CI: .github/workflows/ci.yml (push all branches, PRs; windows; lint/typecheck/test/build; junit artifact on failure)
- Release: .github/workflows/release.yml (CI success on main -> pilot prerelease; workflow_dispatch -> promote stable)
- Deps: .github/dependabot.yml (npm weekly minor+patch group, actions monthly)
- Deploy flow: docs/DEPLOY.md; branch protection payload docs/protection.json
- Monorepo: apps/{desktop,server,cloud-sync}, packages/{domain,contracts,db,ui,documents}
- Key: CLAUDE.md, docs/ARCHITECTURE.md, packages/domain/src/rounding.ts, packages/contracts/src/errors.ts
Next: auth/users/permissions, Prisma company extension, HTTPS, Postgres service.
Known: server HTTP only; cloud-sync empty; release.yml pilot ships source zip only (no installer, no dist script); release workflow untested until first CI run on main; branch protection applied after first push.
