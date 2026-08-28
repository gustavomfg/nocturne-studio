# 1.0.0 release readiness

This is an internal maintainer checklist for the `1.0.0` release candidate. It
records evidence and open release gates; it does not create the `v1.0.0` tag or
claim that a stable release has been published.

## Candidate identity

- Prepared version: `1.0.0` (no prerelease suffix).
- Candidate SHA: must be recorded by the final candidate commit and every
  release workflow; a local build from another SHA is not release evidence.
- Expected stable tag: `v1.0.0`.
- Stable workflow inputs: `release_tag`, the lowercase full `candidate_sha`, and the
  successful `codex_smoke_run_id` for that exact SHA.
- Product identity remains `com.nocturne.codex` / `Nocturne Studio` so existing
  user-data and update paths remain compatible.

## Automated coverage

The current Vitest suite contains **351 tests** across 52 files. The relevant
journeys are covered by:

| Area | Evidence in the repository |
| --- | --- |
| First use and renderer flow | `tests/renderer/renderer.spec.ts` and the Playwright candidate workflow |
| Workspace authorization, relocation and change events | `tests/workspaceTrust.test.ts`, `tests/workspaceChangeWatcher.test.ts`, `tests/electronBoundaries.e2e.test.ts` |
| Conversations, streaming and persistence | `tests/turnPersistence.test.ts`, `tests/codexClient.test.ts`, `tests/database.test.ts` |
| Review and suggestion reconciliation | `tests/suggestions.test.ts`, `tests/database.test.ts`, renderer tests |
| Build approvals, boundaries and rollback | `tests/codexClient.test.ts`, `tests/buildRollbackService.test.ts`, renderer tests |
| Docs preview, concurrency and atomic application | `tests/documentUpdateService.test.ts`, `tests/atomicFile.test.ts`, renderer tests |
| Database, migration, corruption and recovery | `tests/databaseRecovery.test.ts`, `tests/databaseDurability.test.ts`, `tests/sqliteProcessInterruption.test.ts`, `tests/migrationRehearsal.test.ts` |
| Electron/package boundaries | `tests/electronBoundaries.e2e.test.ts`, `scripts/smoke-package.mjs` |
| Codex contract | `scripts/smoke-codex-cli.mjs`, `codex-contract-smoke.yml` |
| Updater contract | `tests/updateService.test.ts`, `scripts/rehearse-updater.mjs`, `updater-rehearsal.yml` |

`package-validation.yml` runs source, renderer, ABI, reliability and package
smoke jobs on `ubuntu-latest`, `windows-latest` and `macos-latest`. The current
local Playwright run contains **47 tests**; the candidate workflow remains the
authoritative cross-platform result.

## Gates closed by current evidence

- Transactional SQLite migrations and the historical `0.9.5-beta` rehearsal;
- WAL durability, process interruption, backup/restore and atomic file writes;
- bounded workspace reads, attachment containment and symlink protections;
- fatal main-process shutdown policy;
- cross-platform WorkspaceChangeWatcher behavior;
- real updater rehearsal from `0.9.5-beta` metadata to stable `1.0.0` metadata;
- authenticated Codex CLI/App Server contract smoke on the candidate workflow;
- packaged recovery rehearsal on Linux, Windows and macOS in the latest
  GitHub Actions matrix evidence supplied for the candidate;
- ordinary packaged application smoke and ABI validation on all three CI hosts;
- public English and pt-BR documentation coverage.

The packaged-recovery engine evidence covers isolated user data, normal restart,
corruption detection, quarantine, valid-candidate restore, invalid-candidate
rejection, temporary recovery-artifact handling, historical startup, moved
workspace authorization and post-recovery restart. Native recovery consent is
deliberately not automated and remains a manual RC check.

## Platform artifacts

The current electron-builder configuration produces:

| Platform | Configured artifact | Architecture claim |
| --- | --- | --- |
| Windows 10/11 | NSIS installer (`.exe`) | x64 |
| Linux desktop | AppImage and `tar.gz` | architecture named by the release artifact |
| macOS | DMG and updater ZIP | architecture named by the release artifact; no universal claim |

Unsigned package validation is distinct from official stable support. Signing
and notarization are release gates, not evidence supplied by ordinary package
smoke jobs.

## Open gates before publication

1. Create the final candidate commit and record its exact SHA.
2. Run the source, renderer, ABI, reliability and unsigned package gates for
   that SHA; the tag must also pass the package-version check.
3. Create tag `v1.0.0` only after those gates pass.
4. Run the authenticated Codex smoke from the exact candidate SHA and pass its
   run ID and SHA to `stable-release.yml`; the report must match the tag SHA and
   `1.0.0`.
5. Complete the protected signed-package matrix: Windows signing, macOS signing
   and notarization, and Linux GPG checksum signing.
6. Run the short [manual RC checklist](release-rc-checklist.md), including the
   native recovery-consent dialog, first startup and install/update checks.
7. Verify checksums, release-asset inventory and the protected stable approval
   before publishing.

The updater rehearsal proves the beta-to-stable metadata path; it does not
publish an update or replace the installer/signing checks. The packaged recovery
rehearsal proves the recovery engine through the real unpacked application; the
native consent click remains manual by design. Signing, notarization, the final
tag and publication are separate gates.

## Out of 1.0 scope

Marketplace, cloud collaboration, multi-agent orchestration, MCP/Skills,
advanced autonomous Build/Docs features and additional provider-specific
adapters are outside the current 1.0 contract. Their absence is not a release
blocker and they must not be presented as implemented.
