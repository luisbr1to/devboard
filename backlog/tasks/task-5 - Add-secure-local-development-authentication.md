---
id: TASK-5
title: Add secure local-development authentication
status: Done
assignee:
  - '@codex'
created_date: '2026-10-02 21:18'
updated_date: '2026-10-02 21:35'
labels: []
dependencies:
  - TASK-2
references:
  - src/server/auth.ts
  - src/Tab/auth.ts
documentation:
  - README.md
modified_files:
  - src/server/auth.ts
  - src/server/api.ts
  - src/index.ts
  - src/Tab/auth.ts
  - src/Tab/api.ts
  - src/Tab/App.tsx
  - src/Tab/App.css
  - tests/auth.test.ts
  - tests/api.test.ts
  - tests/runtime.test.ts
  - tests/browser/ui.spec.ts
  - .env.example
  - m365agents.local.yml
  - infra/azure.bicep
  - README.md
  - backlog.md
  - roadmap.md
priority: high
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Microsoft 365 developer tenant is unavailable, but TestHub still needs to be usable end to end in a normal browser with its Docker PostgreSQL database. Local authentication must be an explicit development facility with server-owned identities, never a client-supplied trust shortcut, and must be impossible to enable in production.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An explicit local authentication mode lets a developer sign in as one of the server-defined local users without Microsoft Entra
- [x] #2 The server derives identity and authorization from an authenticated local session or token and never trusts client-supplied names, roles, or project membership
- [x] #3 Local directory lookup supports adding the configured development users to projects without Microsoft Graph
- [x] #4 Local authentication cannot activate when `NODE_ENV=production` and is disabled by default
- [x] #5 The browser clearly identifies local development mode and supports signing in, switching users, and signing out
- [x] #6 Automated tests cover local sign-in, identity attribution, membership enforcement, tampering, disabled mode, and production rejection
- [x] #7 README and environment examples document local mode separately from optional Entra/Teams integration
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add an explicit `AUTH_MODE=local` backend provider with fixed server-owned development identities and opaque, expiring in-memory bearer sessions. Reject local mode at startup when `NODE_ENV=production`; keep Microsoft authentication as the default.
2. Add local session create/revoke endpoints and expose only safe local user choices through `/api/v1/config`; preserve the existing authorization and membership pipeline after authentication.
3. Extend the browser welcome/session flow to select, persist, switch, and sign out local users while visibly labelling local mode.
4. Configure the ignored local `.env` for local mode while forcing Agents Toolkit flows to Microsoft mode, and document the separation.
5. Add server/API/browser coverage for identity attribution, directory lookup, membership isolation, token tampering, disabled mode, and production rejection. Run full static, build, API/runtime, browser, and Docker-backed health checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented `AUTH_MODE=local` with three fixed server-owned identities, opaque 12-hour in-memory sessions, localhost-only issuance, revocation, and a local directory. Existing project membership and activity attribution remain unchanged after authentication.

Added local browser sign-in, session persistence, user switching and sign-out. Agents Toolkit and Azure configuration force Microsoft mode; production startup rejects local mode.

Verification on 2026-10-02: formatting and typecheck passed; production build passed; all 21 API/runtime tests and 6 Playwright tests passed. A compiled-server smoke against Docker PostgreSQL returned ready, authenticated Ana Silva, rejected a tampered token with 401, and rejected the revoked token with 401.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added secure local-development authentication so TestHub works fully in a browser without Microsoft 365. Server-owned users receive opaque, expiring, localhost-issued sessions; the existing membership and attribution pipeline remains authoritative. Local directory search, user switching, sign-out, tamper rejection, and production blocking are documented and verified by 21 API/runtime tests, 6 Playwright tests, and a compiled-server Docker PostgreSQL smoke test.
<!-- SECTION:FINAL_SUMMARY:END -->
