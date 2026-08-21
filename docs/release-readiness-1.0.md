# 1.0 release readiness

This is an internal maintainer checklist. It describes release evidence; it
does not change the installed version. The current repository version is
`0.9.5-beta`.

## Current HEAD

The candidate audited for this document is the current `main` HEAD. The exact
SHA must be recorded again by every release-candidate workflow; a local build
or a result from another commit is not release evidence.

## Automated coverage

The current Vitest suite contains **324 tests** across 47 files. The relevant
journeys are covered by:

| Area | Evidence in the repository |
| --- | --- |
| First use and renderer flow | `tests/renderer/renderer.spec.ts` |
| Workspace authorization, relocation and change events | `tests/workspaceTrust.test.ts`, `tests/workspaceChangeWatcher.test.ts`, `tests/electronBoundaries.e2e.test.ts` |
| Conversations, streaming and persistence | `tests/turnPersistence.test.ts`, `tests/codexClient.test.ts`, `tests/database.test.ts` |
| Review and suggestion reconciliation | `tests/suggestions.test.ts`, `tests/database.test.ts`, renderer tests |
| Build approvals, boundaries and rollback | `tests/codexClient.test.ts`, `tests/buildRollbackService.test.ts`, renderer tests |
| Docs preview, concurrency and atomic application | `tests/documentUpdateService.test.ts`, `tests/atomicFile.test.ts`, renderer tests |
| Database, migration, corruption and recovery | `tests/databaseRecovery.test.ts`, `tests/databaseDurability.test.ts`, `tests/sqliteProcessInterruption.test.ts`, `tests/migrationRehearsal.test.ts` |
| Electron/package boundaries | `tests/electronBoundaries.e2e.test.ts`, `scripts/smoke-package.mjs` |
| Codex contract | `scripts/smoke-codex-cli.mjs`, `codex-contract-smoke.yml` |
| Updater contract | `tests/updateService.test.ts`, `scripts/rehearse-updater.mjs`, `updater-rehearsal.yml` |

The package-validation workflow runs source, renderer, ABI, reliability and
package smoke jobs on `ubuntu-latest`, `windows-latest` and `macos-latest`.

## Gates closed by evidence

- transactional SQLite migrations and the historical 0.9.5-beta rehearsal;
- WAL durability, process interruption, backup/restore and atomic file writes;
- bounded workspace reads, attachment containment and symlink protections;
- fatal main-process shutdown policy;
- cross-platform WorkspaceChangeWatcher behavior;
- real updater rehearsal from 0.9.5-beta metadata to stable metadata;
- authenticated Codex CLI/App Server contract smoke on the candidate workflow;
- ordinary packaged application smoke and ABI validation on all three CI hosts.

These statements refer to the corresponding evidence for the candidate commit,
not to a promise that every future commit has already been validated.

## Packaged recovery status

`packaged-recovery.yml` builds an unpacked packaged application with isolated
temporary user data and exercises normal restart, corruption detection,
candidate validation, quarantine/restore, historical startup and moved
workspace behavior. The native recovery-consent dialog remains a manual RC
check because production fuses intentionally prevent an inspector-based
automation bypass.

The last recorded matrix run before the diagnostic follow-up passed Linux and
Windows but failed the macOS fixture before the recovery scenarios. The current
HEAD contains the sanitized stage/process diagnostics needed for the next macOS
run. Therefore the cross-platform packaged-recovery gate is **not closed** until
that run succeeds on the exact candidate SHA.

## External release gates

Before a stable tag can be published, `stable-release.yml` requires:

1. a tag exactly matching a version without a prerelease suffix;
2. typecheck, lint, tests, release-metadata validation and Playwright on that
   tag;
3. a successful authenticated Codex smoke whose run and report match the tag
   SHA and package version;
4. signed Windows and macOS packages, macOS notarization and Linux GPG
   checksum-signing in the protected `stable-release` environment;
5. package smoke, checksums and release-asset verification for all platforms;
6. explicit approval of the protected environment before publication.

The final release SHA, manual native recovery-consent check and signed/notarized
installation validation remain release-candidate tasks. No prerelease document
or local package is evidence that `1.0.0` has been published.

## Do not block 1.0 on future scope

Marketplace, cloud collaboration, multi-agent orchestration, MCP/Skills,
advanced autonomous Build/Docs features and additional provider-specific
adapters are outside the current 1.0 contract. They must not be presented as
implemented, but their absence is not a release blocker.
