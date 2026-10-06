# Documentation index

[Português do Brasil](README.pt-BR.md)

English is the canonical public documentation language. User-facing documents
have a `.pt-BR.md` companion with the same technical scope. Commands, paths,
API names, warnings and security claims are kept identical across the pair.

## Public user documentation

- [Installation](installation.md)
- [Getting started](getting-started.md)
- [Providers and models](providers.md)
- [Configuration](configuration.md)
- [Codex CLI integration](codex-integration.md)
- [Review, Build and Docs modes](modes.md)
- [Second Brain](second-brain.md) and [Awareness](awareness.md)
- [Code Intelligence — Phase 2](code-intelligence.md)
- [Backup, restore and recovery](backup-and-recovery.md)
- [Data retention and recovery boundaries](data-retention.md)
- [Updates](updates.md)
- [Security boundaries](security.md) and [privacy](privacy.md)
- [Troubleshooting](troubleshooting.md)
- [Diagnostics](diagnostics.md)
- [Compatibility](compatibility.md)

## Contributor documentation

- [Architecture](architecture.md)
- [Development](development.md)
- [Docs Mode details](docs-mode.md)
- [Build recovery](build-recovery.md)
- [Contributing](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)

## Maintainer/internal documentation

Release readiness, GitHub Actions, database migrations, provider contract,
performance budgets, product identity, security audit, plans and historical
release notes are kept in the repository for engineering traceability. They are
not user support promises and do not all require translation.

The [model strategy](model-strategy.md) is a design guideline. It does not
describe automatic model routing or a reasoning-effort control available in
the current release.

The [GitHub Actions release guide](github-actions.md) describes the current
single-maintainer release procedure. The [1.0.2 readiness document](release-readiness-1.0.2.md)
records historical candidate validation; do not treat it as the current runbook.

The [1.0.2 release notes](releases/v1.0.2.md) record the release body;
the [1.0.1 release notes](releases/v1.0.1.md) and the
[release-candidate checklist](release-rc-checklist.md) remain historical
records for the published stable line.
