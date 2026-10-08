---
id: TASK-4
title: Complete local accessibility and end-to-end validation
status: Done
assignee:
  - '@codex'
created_date: '2026-10-02 14:40'
updated_date: '2026-10-02 21:42'
labels: []
dependencies:
  - TASK-5
references:
  - tests/browser/ui.spec.ts
  - tests/e2e/local.spec.ts
  - tests/e2e/playwright.config.ts
  - src/Tab/App.css
documentation:
  - README.md
modified_files:
  - tests/e2e/database.ts
  - tests/e2e/global-setup.ts
  - tests/e2e/local.spec.ts
  - tests/e2e/playwright.config.ts
  - src/Tab/App.css
  - package.json
  - tsconfig.check.json
  - README.md
  - backlog.md
  - roadmap.md
priority: medium
type: task
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After local authentication is available, TestHub needs a complete browser-level validation against its real Docker PostgreSQL database. Existing mocked browser tests remain useful, but they do not prove the assembled local workflow or a human-readable accessibility pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The complete project, membership, suite publication, manual review, archive, and restore flow succeeds locally against Docker PostgreSQL
- [x] #2 Keyboard-only navigation reaches and operates all primary actions, dialogs, tabs, and result controls with visible focus
- [x] #3 Light, dark, and high-contrast themes remain readable and usable
- [x] #4 Supported desktop and narrow layouts have no blocking clipping or horizontal page overflow
- [x] #5 Portuguese (Portugal) labels are reviewed, including Rejeitado for test rejection and revogar only for integration keys
- [x] #6 Findings and remediation follow-ups are recorded without marking unresolved issues as complete
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a separate Playwright end-to-end configuration that derives an isolated `testhub_e2e` database from the ignored local Docker connection, recreates it safely, applies migrations, and launches the compiled app in local-auth mode.
2. Automate the real browser workflow: local owner sign-in, project creation, local directory membership, integration-key suite publication, member result rejection with reason and attribution, owner archive, and restore.
3. Exercise responsive layout and retain the existing keyboard, light/dark/high-contrast, Portuguese-label, dialog-focus, and tab-navigation browser coverage.
4. Run the isolated Docker-backed end-to-end suite plus all existing checks; record findings as follow-up work and update documentation/status evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Added `npm run test:e2e` with a separate Playwright configuration and a fixed-name `testhub_e2e` database. Setup drops/recreates only that database, applies every versioned migration, and leaves it available for inspection; normal `testhub` data is untouched.
- The real compiled application now has automated coverage for local sign-in, project creation, adding João through the server directory, one-time integration secret use, idempotent suite publication, member rejection with a mandatory reason and actor attribution, owner archive/restore, PT-PT terminology, and a 390x844 viewport.
- Fixed a genuine narrow-layout overflow by allowing detail-grid children to shrink; the test retains a page-width assertion.
- Existing browser coverage verifies light, dark and contrast themes, modal focus containment/return, Escape dismissal, tab arrow navigation, local-user switching and Portuguese rejection labels.
- Verification passed: `npm run check` (typecheck, production build, 21 API/runtime tests), 6 fast Playwright UI tests, and 1 Docker-backed Playwright end-to-end scenario.
- The existing ~700 kB production chunk warning is non-blocking and remains unresolved under TASK-6; it has not been marked complete.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed local accessibility and assembled-system validation against Docker PostgreSQL. Added an isolated real-database Playwright workflow, fixed mobile detail overflow, documented the command and evidence, and retained the production-bundle warning as open TASK-6. Entra/Teams acceptance remains the final externally configured step in TASK-3.
<!-- SECTION:FINAL_SUMMARY:END -->
