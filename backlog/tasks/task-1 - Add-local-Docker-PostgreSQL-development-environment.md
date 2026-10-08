---
id: TASK-1
title: Add local Docker PostgreSQL development environment
status: Done
assignee:
  - '@codex'
created_date: '2026-10-02 14:39'
updated_date: '2026-10-02 14:39'
labels: []
dependencies: []
documentation:
  - README.md
modified_files:
  - compose.yaml
  - .env.example
  - package.json
  - README.md
  - backlog.md
  - roadmap.md
priority: high
type: chore
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Developers need a reproducible PostgreSQL instance for migrations and runtime checks without depending on an unconfigured hosted database. The setup must remain local-only and must not imply that tenant or production acceptance has completed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Docker Compose starts PostgreSQL 16 with a healthcheck and a persistent named volume
- [x] #2 An ignored local `.env` supplies matching application and container connection settings without exposing production secrets
- [x] #3 Project commands start, stop, inspect, and migrate the local database
- [x] #4 Migrations are idempotent and data survives container recreation
- [x] #5 The built application reports a ready database health endpoint
- [x] #6 Typecheck, production build, API/runtime tests, and browser tests pass locally
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add the PostgreSQL Compose service and local environment values.
2. Add npm lifecycle commands and developer documentation.
3. Apply migrations, recreate the container, and probe runtime health.
4. Run static, API/runtime, and browser verification.
5. Record verified versus external acceptance status.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation and verification were already in progress when the Backlog.md workflow was adopted.

Created `compose.yaml`, ignored local environment values, npm database commands, and developer documentation.

Applied migrations 001 and 002, recreated the container while retaining its volume, confirmed an idempotent second migration, and received `{"status":"ready"}` from `/health`.

Verified typecheck, production build, 17 API/runtime tests, and 5 Playwright tests on 2026-10-02.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a PostgreSQL 16 Docker Compose service, ignored local environment configuration, npm database commands, and setup documentation. Verified migrations 001/002, idempotency and volume persistence across container recreation, a ready runtime health endpoint, typecheck, production build, 17 API/runtime tests, and 5 Playwright tests.
<!-- SECTION:FINAL_SUMMARY:END -->
