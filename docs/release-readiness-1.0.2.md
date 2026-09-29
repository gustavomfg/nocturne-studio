# 1.0.2 release readiness

This is an internal maintainer checklist for preparing an unreleased `1.0.2`
candidate. It is not a tag, publication record or authorization to push,
publish a release or modify the historical `v1.0.1` and `v1.0.0` lines.

## Candidate identity

- Candidate package version: `1.0.2` in `package.json` and `package-lock.json`.
- Candidate SHA: freeze the final clean `main` SHA after non-publishing validation;
  record that SHA and its authoritative run IDs in the final stabilization report.
  Protected gates must subsequently validate **that same SHA** before approval/tagging.
  A later source change invalidates the candidate; a future `v1.0.2` tag must point
  exactly to the approved SHA. This document does not itself approve a tag.
- Stable base: `v1.0.1` remains at
  `0f6cd580c447e50e37d48523d5d1667c691f8286`.
- Canonical publication and updater repository:
  `gustavomfg/nocturne-studio`.

## Platform policy

- Linux publishes the configured AppImage and `tar.gz`, with a protected GPG
  signature for its checksum manifest.
- Windows x64 publishes the configured NSIS artifacts with checksums and no
  platform signature under the current policy.
- macOS ARM64 publishes the configured DMG and updater ZIP with checksums and
  no platform signature or notarization under the current policy. Automatic
  update is explicitly unsupported for that unsigned distribution; manual DMG
  upgrade preserves local data. The macOS rehearsal is transport/startup/data
  preservation evidence, not native Squirrel installer certification.
- The `electron-builder` configuration must not request notarization until an
  approved Apple credentials contract, workflow and verification gate exist.

## Completed validation baseline

The stabilization history was fast-forwarded into `main` at
`cb08556dd3ae4e7b99c26bf632fb8c2ebd6652e7`; no history was squashed or rewritten.
Its integrated hosted source/renderer/three-platform package gate passed in
[run 36513047693](https://github.com/gustavomfg/nocturne-studio/actions/runs/36513047693).
This is baseline evidence, **not certification of later commits**.

Local validation after the terminal/updater/dependency fixes, at source baseline
`ed95348`, passed typecheck, lint/design lint, build and Electron/SQLite ABI.
Unit/integration: 577 passed, 12 explicitly skipped across 92 files. Production
and dev-inclusive audits both reported zero vulnerabilities after compatible
lockfile remediation. Renderer/package/updater/final hosted results must be
recorded separately at the final candidate, not inferred from these results.

## Final-candidate gates

The final stabilization report and CI artifacts are the execution ledger for
the selected SHA; absence of evidence means `NOT VERIFIED`, not PASS.

| Gate | Required evidence / boundary |
| --- | --- |
| Source | Typecheck, lint including design lint, build, `git diff --check` at the final SHA |
| Unit/integration and ABI | `npm test`, `npm run test:abi`; skips and platform-specific counts recorded |
| Renderer | `npm run test:renderer`; interaction/visual suite distinct from product dogfooding |
| Native rollback | Real Linux, Windows NTFS and macOS APFS native/decision regressions; no pathname fallback |
| Packages | Hosted Linux/Windows/macOS `--publish never` builds, packaged worker launch and smoke |
| Recovery | Three-platform packaged recovery report; restart does not replay stale capabilities |
| Inventory/checksums | CI platform inventory and SHA256 verification; signing remains protected |
| Security | Production and dev audits; CodeQL coverage stated explicitly |
| Updater | Published immutable `v1.0.1` → actual `1.0.2` rehearsal, no candidate version override/publication |
| Dogfooding | Actual product flows with isolated user data; no fabricated suggestion/decision state |
| Release metadata | `npm run verify:release-metadata`; candidate/version/updater identity consistent |

CodeQL default setup now includes Actions, JavaScript/TypeScript and C/C++.
[Run 36515332891](https://github.com/gustavomfg/nocturne-studio/actions/runs/36515332891)
analyzed `82d2577`; C++ used build mode `none` and reported 1 of 2 source/header
files scanned. This is Linux-hosted static analysis, **not coverage certification
of every Windows/macOS conditional branch**. The final run and outstanding alert
triage belong in the exact-SHA execution ledger. `.gitignore` indexing, global retention/GC and generic editor selection
remain outside this candidate's implemented contract. Retained rollback artifacts
must not be automatically deleted when ownership is uncertain.

## Protected release gates — PENDING

- Authenticated Codex smoke on the authorized dedicated runner at the exact
  candidate SHA. The self-hosted runner was offline during final stabilization;
  ordinary local Review is not a substitute for this protected gate.
- Linux checksum GPG signing and verification in the protected release workflow.
- Environment approval, exact SHA/tag guard and final maintainer authorization.
- Publication itself: **not performed**. No final `v1.0.2` tag is created here.

Windows/macOS platform signing and notarization are **NOT APPLICABLE under the
current unsigned distribution policy**, not completed signing gates. Do not
access credentials or bypass protection to turn pending checks green.
