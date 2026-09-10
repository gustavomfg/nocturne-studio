# 1.0 release readiness and publication record

This is an internal maintainer checklist for the `1.0.1` stable line. The
application tag and version are frozen; release tooling may reconcile
post-publication assets without rebuilding from `main` or changing the tag.

## Candidate identity

- Published version: `1.0.1` (no prerelease suffix).
- Approved application SHA: `0f6cd580c447e50e37d48523d5d1667c691f8286`.
- Stable tag: `v1.0.1`; it must remain exactly on the approved application SHA.
- Canonical publication and updater repository:
  `gustavomfg/nocturne-studio`.
- The historical `v1.0.0` tag and release are immutable reference points.

## Automated coverage

The relevant Vitest suite covers the following release-critical behavior:

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
| Release inventory | `tests/releaseAssets.test.ts`, `scripts/verify-release-assets.mjs` |

`package-validation.yml` runs source, renderer, ABI, reliability and package
smoke jobs on `ubuntu-latest`, `windows-latest` and `macos-latest`. The stable
workflow repeats package smoke from the exact tag before publication and
validates all three platform inventories.

## Platform artifact policy

| Platform | Artifacts | Validation and trust status |
| --- | --- | --- |
| Linux | AppImage and `tar.gz` | SHA256 manifest with protected GPG signature; AppImage is the supported auto-update target |
| Windows x64 | NSIS `.exe` and `.exe.blockmap` | SHA256 manifest; unsigned under the current policy |
| macOS ARM64 | DMG, updater ZIP and both blockmaps | SHA256 manifest; unsigned and not notarized under the current policy |

The configured `electron-builder` targets and `artifactName` values are the
source of truth. No universal macOS claim is made, and checksums are never
presented as platform signing.

## Release gates

1. Confirm the tag, package version and candidate SHA agree.
2. Confirm the authenticated Codex smoke run succeeded for that exact SHA.
3. Run source, renderer, ABI, persistence and package validation.
4. Run `Release · stable`: the protected matrix packages Linux, Windows and
   macOS; only Linux imports GPG credentials and signs its checksum manifest.
5. Verify `app-update.yml` contains the canonical GitHub owner/repository and
   release channel on every packaged platform.
6. Verify the complete release inventory, including blockmaps, updater YAML,
   per-platform checksums, SHA512 metadata and exact versions.
7. Use `docs/releases/v1.0.1.md` as the English GitHub release body. Do not
   replace versioned notes with generated notes.
8. For an existing incomplete release, use the protected backfill workflow.
   It builds missing Windows/macOS assets from the tag SHA, refuses to replace
   existing assets and leaves Linux and `v1.0.0` intact.
9. Perform external post-publication verification of the tag, 16-asset
   inventory, checksums, Linux signature, updater metadata, release notes and
   `v1.0.0` integrity.

## Evidence boundaries

Package-validation artifacts are evidence only and are never published
automatically. A local build or an artifact from another commit is not release
evidence. The final release gate must prove the exact tag SHA again.

Windows and macOS signing/notarization are intentionally not claimed until
trusted platform credentials and a dedicated policy decision exist. Do not
work around that policy by adding fake signatures or weakening the protected
Linux gate.

## Out of 1.0 scope

Marketplace, cloud collaboration, multi-agent orchestration, MCP/Skills,
advanced autonomous Build/Docs features, external telemetry and additional
provider-specific adapters are outside the current 1.0 contract. The future
Nocturne Inspector integration and Nocturne Agent initiative are recorded for
after the current roadmap and are not part of this release.
