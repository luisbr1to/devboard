---
id: TASK-2
title: Use Docker PostgreSQL as the project database
status: Done
assignee:
  - '@codex'
created_date: '2026-10-02 14:39'
updated_date: '2026-10-02 14:54'
labels: []
dependencies: []
references:
  - compose.yaml
  - migrations
documentation:
  - README.md
modified_files:
  - compose.yaml
  - package.json
  - README.md
  - backlog.md
  - roadmap.md
priority: high
type: task
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TestHub needs a durable PostgreSQL database for local development and testing. The Docker Compose service is the project database in this environment; no separate hosted or pilot database is expected. Hosted database validation remains deployment-specific and outside this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Docker Compose runs PostgreSQL 16 bound to localhost with a healthcheck and persistent named volume
- [x] #2 Ignored local environment settings provide matching database name, user, password, port, and application connection URL
- [x] #3 Project commands start, stop, inspect, and migrate the database
- [x] #4 All versioned migrations apply successfully, reruns are idempotent, and data survives container recreation
- [x] #5 The built application connects with the configured runtime URL and `/health` reports ready
- [x] #6 README, roadmap, and status documentation identify Docker PostgreSQL as the local project database without claiming hosted deployment validation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Restrict the Compose database port to localhost and configure reliable local restart behavior.
2. Add an explicit database status command and align environment/documentation wording.
3. Recreate the container while preserving its named volume and rerun migrations to prove idempotency.
4. Start the built application, verify `/health`, and run proportional project checks.
5. Record evidence, check acceptance criteria, and finish the task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Preflight on 2026-10-02 found only the Docker-local DATABASE_URL in `.env`; no `env/.env.local.user` or explicitly selected non-local pilot database is available. Per project rules, migrations have not been attempted against any external database.

Scope corrected after user clarification: this project has no separate pilot database; the Docker PostgreSQL service is the intended project database.

Recreated `testhub-postgres-1` with localhost-only port binding and restart policy; the existing named volume was retained and the service reached healthy state.

Migration rerun produced no pending migration output, confirming the preserved schema ledger and idempotency. The built server returned `{"status":"ready"}`. `npm run check` passed typecheck, production build, and all 17 API/runtime tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Established Docker PostgreSQL 16 as the TestHub project database. It is localhost-only, persistent, health-checked, restartable, and managed through npm commands. Recreated it without losing data, confirmed idempotent migrations and a ready application health check, and passed the full project check with 17 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
