# DevBoard — development workflows

This document describes repository workflows; it is not an installed Codex skill or a source of deployment authority.

## Teams authentication

1. Keep the Entra exposed API URI, Teams `webApplicationInfo.resource`, runtime `ENTRA_RESOURCE_URI` and scope identical.
2. Require v2 access tokens and `access_as_user`. Validate signature, issuer, audience, lifetime, tenant and object ID on the server.
3. Use Teams SSO first, then a Teams authentication window backed by MSAL authorization-code/PKCE. Standalone browsers use an MSAL popup and the dedicated redirect bridge.
4. Keep Graph OBO tokens and client secrets on the server. Directory failure must not prevent members/guests from using existing projects.
5. Verify signed-token tests locally; verify SSO and guest behavior in a real tenant separately.

## Database/API change

1. Extend shared Zod inputs/contracts and OpenAPI together.
2. Add a new numbered migration for schema changes; never overwrite deployed migrations.
3. Resolve project access and acquire its row lock before writes. Enforce archive rules, optimistic versions, parameterized SQL and atomic activity writes.
4. Add behavior tests for success, forbidden access, archived resources, concurrency and rollback when relevant.
5. Run typecheck, tests and build. Run migrations only against the intended configured database.

## UI change

Use Fluent UI and its theme tokens. Labels are pt-PT. Use the shared Markdown renderer, accessible form labels, focus handling, loading/error/empty states and server versions. Preserve unsaved form text on network/conflict errors. Confirm result-resetting edits and archive actions. Test keyboard use and light/dark/high-contrast layouts.

Use the shared native-dialog wrapper with Fluent controls. It owns focus cycling, Escape and opener restoration; regression-test closing a modal whose opener is removed by archive actions. Use Fluent TabList for arrow-key navigation.

## AI publishing

Produce JSON conforming to `examples/suite.json` and the OpenAPI suite input. Keep descriptions and instructions as Markdown. Create a project-scoped key in Definições. Reuse one idempotency key for retries of the same submission; use a new key for an independent suite. Never send result statuses or pretend to execute tests. Use the publishing script with environment-based secrets.

## Handoff

Record verified local checks and outstanding external acceptance separately in backlog.md. Provide configuration requirements and migration commands. Do not claim deployment, real Teams acceptance or hosted PostgreSQL validation unless actually performed.
