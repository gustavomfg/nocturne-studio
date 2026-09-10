# 1.0.1 release-candidate checklist

This is a short manual checklist for the published `v1.0.1` line. Record the
exact commit SHA, artifact name, platform and date for every run. It does not
replace the protected stable-release or cross-platform backfill workflows.

## Candidate identity

- [ ] Confirm `package.json` is `1.0.1`, the approved application SHA is
      `0f6cd580c447e50e37d48523d5d1667c691f8286`, and `v1.0.1` points to it.
- [ ] Confirm the artifact architecture and compare its checksum with the
      release manifest.

## Install and first use

- [ ] Install the Linux AppImage or archive, Windows x64 NSIS installer, and
      macOS ARM64 DMG on their intended platforms.
- [ ] Complete first startup with empty user data, then create and reopen a
      workspace.
- [ ] Open an existing workspace, move it, and confirm that the new location
      requires explicit reauthorization.
- [ ] Run Review Mode and verify that no workspace file is modified implicitly.
- [ ] Run a small approved Build Mode change and inspect its plan, approval,
      diff and rollback behavior.
- [ ] Preview and apply a small Docs Mode change, including a concurrent-edit
      rejection.

## AI and data

- [ ] Configure one supported provider and verify a successful request plus a
      controlled invalid-credential or unavailable-provider error.
- [ ] On an authorized machine, run the Codex authenticated smoke flow with
      CLI `0.145.0` or the verified `0.146.0` recommendation.
- [ ] Restart the app and confirm conversations, settings, memory and workspace
      history remain available.
- [ ] Create a backup, restore it in an isolated test, and verify semantic data
      preservation rather than only file existence.
- [ ] Exercise the native recovery-consent dialog with a corrupt database and a
      valid candidate; confirm quarantine and a successful post-recovery restart.

## Updates, privacy and release gates

- [ ] Check update availability, download confirmation, progress and retry on
      each packaged platform without using real user data in the test fixture.
- [ ] Confirm logs and diagnostics contain no credentials, tokens, prompts or
      private workspace contents.
- [ ] Verify Linux checksum signing in the protected release environment.
- [ ] Record Windows and macOS as unsigned and not-notarized under the current
      release policy; verify their checksums and updater metadata separately.
- [ ] Verify the complete 16-asset `v1.0.1` inventory, including both macOS
      blockmaps, the Windows blockmap, all three updater metadata files and
      all three checksum manifests.
- [ ] Verify the GitHub release body matches `docs/releases/v1.0.1.md` and that
      `v1.0.0` remains unchanged.

Native recovery consent and signing/notarization are release gates, not bypasses
to automate in production.
