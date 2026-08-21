## 1.0.0 — Release candidate (unreleased)

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
- Signing/notarization and final protected publication gates are still required;
  this entry is not a published release.

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
