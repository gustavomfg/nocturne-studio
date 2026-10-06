# GitHub Actions and releases

Nocturne Studio has one maintainer. Normal CI and releases run only on GitHub-hosted
Linux, Windows and macOS runners. No authenticated personal Codex session, local
Actions runner or independent reviewer is required for a stable release.

## Normal release

1. Finish the version, release notes and code changes on `main`; push them and
   wait for **CI · source, renderer and packages** to pass for that exact commit.
2. Create a lightweight version tag at that commit and push it. For example:

   ```bash
   git switch main
   git pull --ff-only
   git tag v1.0.2
   git push origin refs/tags/v1.0.2
   ```

3. Watch **Release · stable**. The tag push starts it automatically. A failed
   run does not publish a release; after a transient failure, rerun the workflow
   from the same tag. Do not move a published tag.

The release workflow checks that the tag, package version, release notes,
current `main` and successful main CI all refer to the same commit. It packages
and smoke-tests Linux x64, Windows x64 and macOS ARM64, checks updater identity,
generates checksums, signs and verifies the Linux checksum manifest, validates
all staged assets, then publishes the release. A final step compares every
published asset's SHA-256 digest and size with the verified build, checks the
release notes and tag, and verifies the Linux GPG signature using the public key
in `docs/release-signing-public.asc`.
The expected Linux signing key fingerprint is
`C9E71B2FB90821EDBC041973D078F5B07AF924A7`.

The `stable-release` environment limits access to the existing Linux GPG
secrets and deployment to `v*` refs. For this single-maintainer repository it
has no required reviewer or wait timer, and administrator bypass is disabled.
Only Linux signing steps receive `GPG_PRIVATE_KEY` and `GPG_PASSPHRASE`. Windows
and macOS remain unsigned; macOS notarization is not required. Missing Linux
signing credentials or a failed signature check stop publication.

The release cannot replace an existing GitHub Release. If a tag points to a
different commit or `main` advances while packaging, the workflow stops. A tag
from an unpublished failed attempt must be investigated before deletion; never
force-move it or touch a published version.

## CI and diagnostics

- **CI · source, renderer and packages** runs on pushes to `main`, version tags
  and relevant pull requests. It checks workflows, typecheck, lint, tests,
  renderer interactions, native ABI, packaged smoke and cross-platform builds.
- **Security · dependencies** and CodeQL remain automated security signals.
- Native rollback, recovery and updater rehearsals remain separate automated
  validation workflows where applicable.
- `npm run smoke:codex` is an optional local diagnostic for a maintainer with an
  authenticated Codex CLI. It exercises the real App Server and writes a
  sanitized report. It is not a release prerequisite. Deterministic Codex
  contract tests remain in `npm test` and run on GitHub-hosted CI.

The historical v1.0.1 cross-platform backfill was a one-time recovery. The
stable workflow now publishes the full platform inventory in one run and does
not silently replace published assets.
