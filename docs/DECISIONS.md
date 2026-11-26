# Decisions (date | decision | reason)
2026-11-26 | Use installed pnpm 12.18 (packageManager pinned) instead of pnpm 9 | only version installed; no downgrade needed
2026-11-26 | TypeScript 5.9.3, React 18.3.1, Prisma 6.19.3, Electron 33 pinned | latest resolved were TS7/React19/Prisma7-8rc, incompatible with spec/ecosystem
2026-11-26 | Libs build with tsc to dist (CJS); root typecheck builds libs first | simple consumption by NestJS without bundler
2026-11-26 | Root eslint/vitest (not pnpm -r) for lint/test | single config, faster; dev/build/typecheck use pnpm -r
2026-11-26 | Server hello listens plain HTTP on 47820 | HTTPS/TLS arrives with server phase
2026-11-26 | Prisma companyId extension, DB journal trigger deferred | no business tables yet
