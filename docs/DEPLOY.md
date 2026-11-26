# Release flow
1. Push to `main` -> CI runs (lint, typecheck, test, build).
2. CI green -> `release.yml` creates pilot prerelease `v<V>-pilot.<run>` with assets.
3. Test on the pilot PC.
4. GitHub > Actions > Release > Run workflow, enter version `<V>`.
5. Promote creates stable release `v<V>` (marked latest) from the newest pilot.
6. Customer installs auto-update to the latest stable release.

Branch protection (run once, needs admin; `gh` is authenticated):
```
gh api -X PUT repos/ddotsmedia/ddinvoice-desktop/branches/main/protection --input protection.json
```
`protection.json`: `{"required_status_checks":{"strict":false,"contexts":["ci"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}`
