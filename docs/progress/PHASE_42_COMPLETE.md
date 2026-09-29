# Phase 42 — progress report

**Phase status: INCOMPLETE.** This file is deliberately not a completion claim.

**Latest entry: security-contract correction recorded — see [Phase 42 privilege contract](../architecture/PHASE_42_PRIVILEGE_CONTRACT.md).** Hosted verification exposed a privilege drift against the hosted Supabase public schema. The cause, the three observed failures, and a forward corrective migration are documented at that link. The corrective migration has **not** been applied to the hosted project. Phase 42 remains open.

## Verified locally

- Baseline HEAD was `085191a1e44d4885036cc2f09e3636e9467a040e` on `fix/format-money-parser-and-date-semantics`.
- Migration inventory contains four ordered SQL files; see [hosted status](../architecture/PHASE_42_HOSTED_SUPABASE.md).
- `npx tsc --noEmit`: PASS.
- `eslint . --max-warnings=0`: PASS (via `npm run verify`).
- Jest in-band: 29 suites passed, 905 tests passed.
- `npx expo export --platform web`: PASS.
- Targeted generated-bundle credential scan: no private-key, Google API key, OpenAI key, or Supabase secret-key pattern matched. One public Supabase publishable-key pattern matched, as expected for client configuration.
- `git diff --check`: PASS at the time of this report.

The first `npm run verify` attempt stopped at Jest because the default worker process could not spawn (`EPERM`); rerunning Jest in-band succeeded. Expo export loaded a local `.env`; secret values were not displayed. A scan match for the publishable key is not a private credential leak.

## Security-contract correction — privilege drift on the hosted schema

Hosted RLS and security verification found that the repository's privilege contract was not enforced on the hosted project. Full analysis: [Phase 42 privilege contract](../architecture/PHASE_42_PRIVILEGE_CONTRACT.md).

Three guarantees that were true in the migration source were false on the hosted database:

1. `authenticated` held `UPDATE` and `DELETE` on `public.activity_log`, which is meant to be append-only.
2. `service_role` held `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `public.ai_provider_configs`, which is meant to be reachable only through `SECURITY DEFINER` functions.
3. `anon` and `authenticated` held `EXECUTE` on all six `public.ai_gateway_*` functions, including the one that returns plaintext.

Common cause: the migrations state privileges as an absence — a role not named in a `GRANT` is assumed not to hold it. On the hosted project the `public` schema carries default privileges for the `postgres` migration runner granting `ALL` on tables, functions and sequences to `anon`, `authenticated` and `service_role`. Those are named-role ACL entries, so `revoke execute ... from public` (which removes only grantee `0`) and any later `GRANT` both leave them intact. The repository contained no `ALTER DEFAULT PRIVILEGES` statement of any kind.

Correction recorded:

- New forward migration `supabase/migrations/20260929120000_privilege_contract.sql` — `REVOKE` only, 13 statements, no grant, no create, no drop, no policy change, no function redefined. It restores the three guarantees and revokes the migration runner's default privileges for future objects in `public`.
- All four existing migrations were left unmodified. They are already applied on the hosted project; editing them would change nothing there while making a fresh reset disagree with production.
- `supabase/tests/rls_isolation.sql` was left unmodified.
- The hosted database was manually corrected during verification, so the hosted state and the migration chain currently **diverge**. A fresh reset, shadow database, or new project would still reproduce the uncorrected schema until this migration is applied.

Still outstanding, and the reason Phase 42 stays open:

- Applying `20260929120000_privilege_contract.sql` to the hosted project. Deliberately not done in this task.
- Re-verifying the three corrected contracts on hosted after application.
- Reconciling the objects this migration does not cover: the same default-privilege mechanism also granted `anon` and `service_role` `ALL` on `organizations`, `organization_members`, `departments`, `employees`, `projects`, `project_members` and `tasks`, and granted `EXECUTE` to the client roles on the 25 functions in the first three migrations.
- Strengthening the test suite. Sections 14.8 and 14.9 cannot distinguish a privilege refusal from an RLS policy refusal — both raise SQLSTATE `42501` — so the `activity_log` contract passed locally regardless of the grant, and the `grantee = 0` catalog check cannot see a named-role grant.

No new hosted change was made in this task. No Docker was used, the database was not reset, no migration history was rewritten, and no credential, token, project reference, or provider secret was written to any file or to Git.

## Earlier state — superseded

The sections below record the period before hosted access was restored. They are kept for history and no longer describe the current state.

## Not verified against hosted Supabase

- Hosted project identity, reference, region, database version, and connectivity.
- Migration application and live schema, indexes, constraints, grants, RLS, and functions.
- Hosted execution of `supabase/tests/rls_isolation.sql` and runtime assertion counts.
- Auth signup, login, session restoration, refresh, logout, and password reset.
- Organization isolation, permissions, live CRUD, dashboard metrics, and demo/live separation.
- Hosted AI provider configuration protections, Vault availability and RPC behavior, or Edge Function deployment and authorization.
- Hosted error behavior and disposable-data/secret cleanup.
- Whether the local `.env` targets the intended hosted project.

The read-only `npx supabase projects list` check returned `Unauthorized`. There was no authenticated Dashboard browser session.

## Resumed attempt — still blocked

On resumption, the environment variable `SUPABASE_ACCESS_TOKEN` was found **present**, but the read-only `npx --no-install supabase projects list` check again returned `Unauthorized`. The configured token is invalid, expired, or revoked. No hosted project reference could be confirmed and no hosted mutation was attempted; no credential value was printed or stored. Phase 42 remained BLOCKED at that point — Supabase authentication. See [hosted status](../architecture/PHASE_42_HOSTED_SUPABASE.md) and [RLS verification status](../architecture/PHASE_42_RLS_LIVE_VERIFICATION.md).

## Git delivery

Phase 42 is delivered incrementally and is **not** complete. The privilege-contract correction described above is committed separately as `fix(phase-42): enforce hosted privilege contract`.

The workspace contained pre-existing untracked files before this work, including `create_arch.py`, `create_progress.py`, `diff.txt`, `diff.txt.output`, `format-at-head.txt`, `format-parent.txt`, `git_add.txt`, `docs/EDGE_FUNCTION_AUDIT.md`, and `docs/SUPABASE_FEATURE_INVENTORY.md`; they are unrelated scratch or audit output and are deliberately left unstaged. Do not label the phase complete or deliver the requested activation commit until the corrective migration is applied to the hosted project and the remaining hosted verification and cleanup are actually complete.

## Next step

Apply `supabase/migrations/20260929120000_privilege_contract.sql` to the hosted project through the supported hosted workflow, after re-confirming the intended project reference, then re-verify the three corrected privilege contracts. After that, reconcile the remaining default-privilege exposure on the other tables and functions, strengthen the test suite to assert named-role privileges, and continue the outstanding hosted Auth, organization isolation, CRUD, Vault, Edge Function, and cleanup checks. Do not put an access token, service-role key, database password, or provider credential in Git, documentation, chat, or terminal output.
