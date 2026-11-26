# Decisions (date | decision | reason)
2026-11-26 | Use installed pnpm 12.18 (packageManager pinned) instead of pnpm 9 | only version installed; no downgrade needed
2026-11-26 | TypeScript 5.9.3, React 18.3.1, Prisma 6.19.3, Electron 33 pinned | latest resolved were TS7/React19/Prisma7-8rc, incompatible with spec/ecosystem
2026-11-26 | Libs build with tsc to dist (CJS); root typecheck builds libs first | simple consumption by NestJS without bundler
2026-11-26 | Root eslint/vitest (not pnpm -r) for lint/test | single config, faster; dev/build/typecheck use pnpm -r
2026-11-26 | Server hello listens plain HTTP on 47820 | HTTPS/TLS arrives with server phase
2026-11-26 | Prisma companyId extension, DB journal trigger deferred | no business tables yet
2026-11-26 | Version 0.1.0 for apps/desktop and apps/server | scaffold is first numbered prompt; minor bump per rule 15
2026-11-26 | Remote origin https://github.com/ddotsmedia/ddinvoice-desktop, first push without pull --rebase | remote repo empty, no origin/main to rebase onto
2026-11-26 | Pilot prerelease uses source zip until root `dist` script exists | installer not built yet (Prompt 9)
2026-11-26 | Promote job runs on ubuntu-latest, pilot on windows-latest | promote needs only gh/jq; pilot may build Windows installer
2026-11-26 | Branch protection requires check "ci" and blocks force push, no PR requirement | direct pushes per rule 13 still allowed
