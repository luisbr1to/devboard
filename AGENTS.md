# DevBoard (antigo TestHub) — contributor instructions

## Architecture

React 19 + Fluent UI v9 inside a Microsoft Teams tab at `/tabs/home/`. Express API at `/api/v1`; PostgreSQL via `pg`. `src/shared/contracts.ts` defines validated inputs, public contracts and status aggregation. `src/server/api.ts` owns access checks and transactional workflows. Frontend files live in `src/Tab`. Server build bundles local backend modules into `dist/index.js`.

## Product rules

- UI language is Portuguese (Portugal). `revoked` always displays as **Rejeitado**, never Revogado. Integration key revocation is a separate concept and may use “revogar chave”.
- Projects contain independent suites (Suite de testes) and issues (Desenvolvimento); tests are manual, never automatically executed.
- An issue's reporter is always the authenticated creator and is never accepted from the client or changed. Any member can assign people or self-assign. Issue statuses, modules and labels are per project and owner-managed; a project always keeps a "todo" and a "done" status.
- Spreadsheet imports are owner-only, transactional, idempotent and send no notifications.
- A first-run setup protected by a setup code (`TESTHUB_SETUP_CODE`, or generated and logged) creates the single master administrator; until then only `GET /me` and `POST /setup` work. Application administrators (`app_admins`) create projects, add/remove administrators and act as owners in every project without being members (no notifications, not assignable). The master can never be removed.
- Roles are owner, member and viewer. Viewers are read-only (refused in `projectScope` for any write or project lock) and never assignable. Owners can temporarily block other non-owner members; a blocked membership hides the project, its notifications and search results until lifted or `blocked_until` passes.
- The rename to DevBoard is visual only: keep the `testhub` database/volume names, `TESTHUB_*` variables, `th_` key prefix and `testhub.*` browser keys.
- Any project member can record results. A rejection must atomically include a nonempty explanation and actor attribution.
- Progress counts approved and rejected tests. Empty suites remain pending. Suite status is derived, never directly editable.
- Owners manage membership, keys and archival. Archived suites/projects are read-only; restoration preserves history. No permanent deletion.
- Editing instructions or expected results resets a test to pending and requires UI confirmation when replacing a recorded result.
- Never infer identity or authorization from Teams context or client-supplied display names. Verify Entra JWTs and enforce membership on every resource request.
- Publishing keys can only create suites in their project. Store hashes, expose secrets once, and require idempotency keys.

## Commands and checks

`npm install`; `npm run typecheck`; `npm test`; `npm run build`; `npm run dev`; `npm run db:migrate` (only against an explicitly selected database); `npm run publish:suite -- file.json PROJECT_ID IDEMPOTENCY_KEY`.

Tests use PGlite (an embedded PostgreSQL engine) and an injected test authenticator. That authenticator must never be wired into production. Real tenant SSO, guest sign-in, Graph consent and hosted PostgreSQL acceptance require configured external services; report those checks separately and honestly.

## Change discipline

Use parameterized SQL and versioned, additive migrations. Do not rewrite applied migrations. Serialize project mutations using the project row lock, check resource versions, and write result/activity changes within the same transaction. Preserve existing user work. Keep secrets out of code, docs, logs and frontend bundles. Update README, roadmap.md and backlog.md when behavior or verification status changes. Deployment and app publication are separate from local implementation.
