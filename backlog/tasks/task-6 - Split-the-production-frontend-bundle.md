---
id: TASK-6
title: Split the production frontend bundle
status: To Do
assignee: []
created_date: '2026-10-02 21:41'
labels: []
dependencies: []
references:
  - vite.config.js
  - src/Tab/App.tsx
documentation:
  - README.md
priority: low
type: enhancement
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The production build currently emits a Vite warning because the main JavaScript chunk is about 700 kB after minification. Reduce initial loading cost without changing TestHub behaviour; this performance follow-up does not block the locally validated product workflow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The production build no longer emits the 500 kB chunk warning, or a measured and documented threshold is explicitly justified
- [ ] #2 Lazy loading or manual chunking preserves authentication, project, suite, settings, and Teams-hosted navigation
- [ ] #3 Typecheck, API/runtime tests, browser tests, and the Docker-backed end-to-end flow still pass
<!-- AC:END -->
