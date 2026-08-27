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
- [Backup, restore and recovery](backup-and-recovery.md)
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

The [release-readiness checklist](release-readiness-1.0.md) is the current
source for open release gates. Do not treat a plan or historical release note as
evidence that a feature is present in the current build.

The [1.0.0 release notes](releases/v1.0.0.md) and the
[release-candidate checklist](release-rc-checklist.md) describe the candidate
without claiming that the stable tag has been published.
