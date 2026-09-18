# 1.0.2 release readiness

This is an internal maintainer checklist for preparing an unreleased `1.0.2`
candidate. It is not a tag, publication record or authorization to push,
publish a release or modify the historical `v1.0.1` and `v1.0.0` lines.

## Candidate identity

- Candidate package version: `1.0.2` in `package.json` and `package-lock.json`.
- Candidate SHA: to be selected only after the local and protected gates pass;
  a future `v1.0.2` tag must point exactly to that approved SHA.
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
  no platform signature or notarization under the current policy.
- The `electron-builder` configuration must not request notarization until an
  approved Apple credentials contract, workflow and verification gate exist.

## Local gates

Record the exact commit and result for each applicable command:

- [ ] `npm run typecheck`
- [ ] `npm run lint` (includes the design-system lint)
- [ ] `npm test`
- [ ] `npm run test:renderer`
- [ ] `npm run build`
- [ ] `npm run verify:release-metadata`
- [ ] `npm run package:dir -- --publish never`
- [ ] `npm run smoke:package`
- [ ] `npm run rehearse:updater` with isolated base and candidate artifacts
- [ ] `npm run verify:release-assets -- <release-directory>` with the complete
      platform inventory
- [ ] `npm run verify:signatures` where the local platform and artifacts allow
      it without protected credentials
- [ ] `git diff --check`

## Protected and cross-platform gates

The package-validation matrix must run on Linux, Windows and macOS. The stable
workflow must later verify the exact candidate SHA and tag before any
publication. Linux GPG signing, authenticated Codex smoke, protected approvals,
and real-runner packaging remain environment-dependent. macOS signing and
notarization are not claimed by this candidate.

No tag, GitHub release, asset upload or push is created by this preparation.
