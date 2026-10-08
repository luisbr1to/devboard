---
id: TASK-3
title: Integrate Microsoft Entra and Teams authentication
status: To Do
assignee: []
created_date: '2026-10-02 14:39'
updated_date: '2026-10-02 21:18'
labels: []
dependencies:
  - TASK-4
references:
  - appPackage/manifest.json
  - src/server/auth.ts
documentation:
  - README.md
priority: high
type: task
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once the complete application is working and validated locally, optional Microsoft Teams deployment requires replacing local authentication with tenant-backed SSO, verified JWTs, Graph consent, and real member and guest acceptance. This is deliberately the final integration stage because the required Microsoft 365 developer tenant is not currently available.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Entra resource application exposes the expected v2 API scope, redirect URI, and Teams client pre-authorizations
- [ ] #2 Server-only tenant, client, resource, and Graph OBO configuration is supplied without entering frontend bundles or source control
- [ ] #3 An internal project member signs in and completes an authorized API workflow in Teams web and desktop
- [ ] #4 An existing B2B guest signs in, accesses only assigned projects, and records a manual result
- [ ] #5 An authenticated non-member cannot discover or access project resources
- [ ] #6 Graph member search works for an authorized internal owner and documented guest restrictions produce the intended fallback
- [ ] #7 Sanitized acceptance evidence and tenant-specific limitations are recorded
<!-- AC:END -->
