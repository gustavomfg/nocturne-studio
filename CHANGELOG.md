## 1.0.2 — Release candidate (unreleased)

### Fixed

- Protected rollback now uses native capabilities on supported Linux local
  filesystems, Windows NTFS and macOS APFS instead of reusing checked pathnames
  for mutation. Collisions preserve competing data; unsupported cases fail closed.
- Change decisions verify filesystem results before terminal persistence, retain
  recovery evidence and do not claim success after interruption or lost confirmation.
- Codex events are isolated by turn, preparation failures finish their reserved
  execution, and failed or invalid Reviews cannot silently resolve earlier findings.
- Concurrent Codex startup requests wait for the pending compatibility handshake
  instead of treating a live but uninitialized App Server as ready.
- Validation rechecks authorization after asynchronous preparation. Project index
  relations are invalidated when new targets change import resolution, and older
  same-session refreshes cannot overwrite newer renderer state.
- Linux terminal launch discovers supported installed applications without requiring
  `x-terminal-emulator`; Windows workspace paths are not interpolated into a shell command.
- Build/test dependency advisories were remediated without changing adopted major lines.

### Validation and limits

- Cross-platform native, package and recovery gates remain separate from protected
  authenticated Codex and Linux checksum-signing gates. The updater rehearsal now
  uses the published `1.0.1` baseline and the actual `1.0.2` candidate version.
- Rollback is not a global filesystem/SQLite transaction or a guarantee of continuous
  pathname membership. Retained artifacts require manual reconciliation; see
  [the implemented restrictions](docs/native-rollback-v1.md).

## 1.0.1

### Changed

- Consolidates the final release-candidate line without introducing a new
  feature phase.
- Hardens release and updater verification around the published `1.0.0` to
  `1.0.1` migration path.
- Establishes `gustavomfg/nocturne-studio` as the canonical distribution and
  updater identity while preserving the GitHub rename bridge for `v1.0.0`.

## 1.0.0

### Added

- Stable Review, Build and Docs workflows with explicit workspace authorization,
  approvals, diffs and controlled recovery boundaries.
- Local Second Brain and Awareness context with persistent conversations,
  suggestions and workspace-scoped knowledge.
- Provider configuration for ChatGPT through Codex CLI/App Server and
  OpenAI-compatible endpoints.

### Changed

- Cross-platform packaging, update metadata and release validation now cover
  Linux, Windows and macOS through reproducible CI gates.
- Codex compatibility is checked through the App Server handshake; the minimum
  supported CLI is `0.145.0` and `0.146.0` is the recommended verified version.

### Security and reliability

- Hardened IPC, workspace containment, bounded reads, symlink protections and
  fatal main-process shutdown behavior.
- Added transactional migration rehearsal, WAL durability, atomic writes,
  backup validation, quarantine and database recovery evidence.
- Provider credentials remain in OS secure storage and are excluded from backups
  and diagnostics.

### Documentation

- Added aligned English and Brazilian Portuguese user documentation, installation
  guidance, recovery guidance and release-candidate checks.

### Known limitations

- The Codex App Server contract remains experimental.
- OpenAI-compatible endpoints do not expose identical tool-calling capabilities,
  and dedicated native Anthropic, Gemini and GitHub Copilot adapters are outside
  the 1.0.0 contract.
- Windows and macOS distribution remains unsigned and not notarized under the
  current policy; Linux checksum signatures use the protected release workflow.

## 0.9.5-beta

### Added

- Workspace Memory and Second Brain.
- Real Codex CLI execution lifecycle.
- ChatGPT account and API provider separation.
- Secure Provider abstraction layer.
- Provider Registry and Model Registry.
- Provider-independent Task Builder.

### Changed

- Project renamed from Nocturne Codex to Nocturne Studio.
- Documentation reorganized.
- CI/CD and release pipeline improved.
- Electron packaging validation expanded.

### Security

- SQLite files restricted to local user.
- Credential Vault improvements.
- Secure Provider configuration.
- Production audit with zero vulnerabilities.

### Quality

- Automated unit, integration and renderer regression tests.
- Playwright regression suite.
- Packaging smoke tests.
- Codex CLI smoke validation.
- Actionlint.
- Production dependency audit.

### Known limitations

- Build Mode and Docs Mode still depend on Codex CLI.
- Stable signing identities are external.
- electron-builder development dependency alerts remain pending upstream fixes.
