# Architecture

```
 SERVER PC                                   WORKSTATION PC(s)
+------------------------------------+      +-------------------+
| Windows services                   |      | Electron UI only  |
|  PostgreSQL 16 (127.0.0.1:47821)   |      | (React, i18next)  |
|  Local API  NestJS  (:47820 HTTPS) |<-----| HTTPS over LAN    |
|  Worker (jobs, sync)               |      +-------------------+
+----------------|-------------------+
                 | optional one-way sync
                 v
        cloud-sync receiver (:47900)
```

## Data flow
UI -> HTTPS (JWT, Idempotency-Key) -> API guards -> Zod -> service -> single DB tx (+audit) -> JSON (decimals as strings).
Worker reads outbox -> pushes to cloud-sync (one-way).

## Authority rule
Only apps/server allocates document numbers, posts journals and changes issued docs.
Desktop never touches the DB; it holds no business rules beyond display.

## Ports
- API 47820 HTTPS, LAN
- PostgreSQL 47821, 127.0.0.1 only
- cloud-sync 47900

## Packages
domain (decimal rules) | contracts (Zod, errors, permissions) | db (Prisma) | ui | documents (HTML templates, fonts)
