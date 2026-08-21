# Nocturne Studio

[Português do Brasil](README.pt-BR.md)

> A local-first desktop workspace for understanding, reviewing and evolving real software projects with AI.

Nocturne Studio keeps a project workspace, its conversations, engineering
findings and durable knowledge together. It is a desktop engineering workspace,
not an IDE, an autonomous replacement for a developer, or an official OpenAI
product.

It addresses the context fragmentation of prompt-only tools: project state,
review evidence, decisions and approved knowledge remain connected instead of
being reconstructed in every conversation.

![Nocturne Studio workspace](docs/images/Captura_de_tela_20260803_145710.png)

## What it does

- **Workspaces:** explicitly select and authorize a project directory; moved or
  restored workspaces remain unauthorized until selected again.
- **Review Mode:** read-only analysis with evidence-backed suggestions and
  reconciliation of new, persistent and resolved findings.
- **Build Mode:** Codex-assisted changes inside the authorized workspace, with
  approvals, progress, a visible diff and guarded rollback when its preconditions
  are met.
- **Docs Mode:** preview, compare and apply incremental Markdown updates with
  confirmation, concurrency checks and atomic writes.
- **Second Brain and Awareness:** local, structured memories with approval,
  scope, freshness and an explanation of the context selected for each run.
- **Conversations and Git:** persistent conversations, paginated histories,
  workspace Git status and commit preparation.
- **Provider layer:** a ChatGPT account through the Codex CLI/App Server, plus
  OpenAI-compatible remote and local endpoints.

The developer remains responsible for intent, approval, review and the final
change to a project.

## Supported release artifacts

Official release validation currently covers:

| Platform | Artifact configured by the build |
| --- | --- |
| Windows 10/11 | x64 NSIS installer (`.exe`) |
| Linux desktop | AppImage and `tar.gz` (the published build architecture applies) |
| macOS | DMG and updater ZIP (the published build architecture applies) |

Unsigned package validation runs on Linux, Windows and macOS. A stable release
must additionally pass the protected signing/notarization and checksum gates;
see [installation](docs/installation.md) and [compatibility](docs/compatibility.md).

## AI connections

Review can use a configured OpenAI-compatible provider. Build and Docs use the
Codex CLI/App Server. Available OpenAI-compatible targets include OpenAI API,
OpenRouter, DeepSeek, Ollama, LM Studio and custom compatible endpoints. A
ChatGPT subscription is connected through the Codex CLI; it is separate from
OpenAI Platform API billing.

Provider API credentials are encrypted by the operating-system secure storage,
kept in the main process and excluded from backups and diagnostics. See
[providers](docs/providers.md) and [Codex integration](docs/codex-integration.md).

## Local data and recovery

Conversations, settings, model catalog data and structured knowledge are stored
in a local SQLite database. Workspace context files use bounded, atomic writes.
The application validates the database, creates snapshots before destructive
data operations and can quarantine a corrupt database before restoring a valid
candidate with user confirmation. Backups do not include project files or
provider credentials. These mechanisms reduce recovery risk; they are not a
promise of absolute durability against every hardware or filesystem failure.

Read [backup and recovery](docs/backup-and-recovery.md) before moving or
restoring a workspace.

## Security and privacy

The renderer runs with isolation, sandboxing and no Node.js integration. Native
capabilities cross named preload APIs and validated IPC handlers. Workspace paths
are contained and rechecked, Review remains read-only, and remote providers use
HTTPS with address validation. Nocturne is local-first, but selected prompts,
context and attachments are sent to the provider the user chooses. See
[security](docs/security.md), [privacy](docs/privacy.md) and
[SECURITY.md](SECURITY.md).

## Requirements for development

- Node.js `>=24.18 <25`
- npm `>=11 <12`
- native build tooling compatible with `better-sqlite3`

```bash
npm ci
npm run dev
```

The full command list is in [development](docs/development.md).

## Current status

The repository is on the `v0.9.5-beta` line and is in 1.0 release preparation.
The version is intentionally not changed to `1.0.0` by this documentation.
The Codex App Server contract is experimental; the minimum supported CLI is
`0.145.0` and the recommended version is `0.146.0`. Newer versions must pass
the runtime compatibility handshake.

Known 1.0 limitations include the experimental Codex App Server contract,
OpenAI-compatible adapters without normalized tool calling, and advanced
autonomous/build-orchestration features outside the current protected modes.
Dedicated Anthropic, Gemini and GitHub Copilot adapters, marketplace,
cloud collaboration and multi-agent orchestration are not part of this release
contract.

## Documentation

- [Documentation index](docs/README.md) · [Português](docs/README.pt-BR.md)
- [Installation](docs/installation.md) · [Português](docs/installation.pt-BR.md)
- [Getting started](docs/getting-started.md) · [Português](docs/getting-started.pt-BR.md)
- [Providers](docs/providers.md) · [Português](docs/providers.pt-BR.md)
- [Configuration](docs/configuration.md) · [Português](docs/configuration.pt-BR.md)
- [Codex integration](docs/codex-integration.md) · [Português](docs/codex-integration.pt-BR.md)
- [Review, Build and Docs modes](docs/modes.md) · [Português](docs/modes.pt-BR.md)
- [Second Brain and Awareness](docs/second-brain.md) · [Português](docs/second-brain.pt-BR.md)
- [Backup and recovery](docs/backup-and-recovery.md) · [Português](docs/backup-and-recovery.pt-BR.md)
- [Updates](docs/updates.md) · [Português](docs/updates.pt-BR.md)
- [Security](docs/security.md) · [Português](docs/security.pt-BR.md)
- [Privacy](docs/privacy.md) · [Português](docs/privacy.pt-BR.md)
- [Troubleshooting](docs/troubleshooting.md) · [Português](docs/troubleshooting.pt-BR.md)
- [Development](docs/development.md) · [Português](docs/development.pt-BR.md)
- [Architecture](docs/architecture.md) · [Português](docs/architecture.pt-BR.md)
- [Release readiness (maintainer document)](docs/release-readiness-1.0.md)

English is the canonical public source. Portuguese translations use the
`.pt-BR.md` suffix and preserve headings, commands, paths and technical names.

## License

Nocturne Studio is distributed under the [MIT License](LICENSE).
