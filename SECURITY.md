# Security policy

[Português do Brasil](SECURITY.pt-BR.md)

Nocturne Studio is a local desktop application, but it handles project files,
provider credentials and communication with external AI services. Security
reports are welcome.

## Reporting a vulnerability

Do not include secrets, project files or private prompts in a public issue. Use
the repository's GitHub Security Advisory feature for a private report when it
is available. If private reporting is unavailable, open a minimal issue that
contains no sensitive details and ask the maintainers for a private channel.

Include, when safe:

- affected version or commit;
- operating system and architecture;
- impact and a minimal reproduction;
- expected and actual behavior;
- a mitigation or workaround, if known.

Before sharing logs, remove API keys, access tokens, cookies, database files,
workspace contents and personal information.

## Supported security scope

The policy covers the desktop application, Electron main/preload/renderer
boundaries, IPC validation, workspace authorization and containment, persistence
and recovery, provider integrations, credential storage and packaged updates.
Third-party providers and the Codex CLI have their own security policies.

The repository is prepared as the `1.0.0` release candidate. Stable support for
that version begins only after the `v1.0.0` tag and protected publication; the
candidate has not been published yet. Historical beta notes are not a promise
of support for old versions.

## Security design

- Renderer `contextIsolation` and sandboxing are enabled; Node integration is
  disabled.
- The preload exposes named APIs rather than a generic IPC bridge.
- IPC validates origin, payload, rate and workspace authorization before native
  work begins.
- Review Mode is read-only. Build writes are scoped to the authorized workspace,
  use Codex approvals and disable network access for the agent sandbox.
- Workspace paths are contained and bounded reads reject traversal and symlink
  escapes where the platform permits them.
- Provider credentials are encrypted with the operating-system secure storage,
  never returned to the renderer and excluded from backups and diagnostics.
- Remote OpenAI-compatible connections require HTTPS, reject redirects and
  validate resolved addresses to reduce SSRF and DNS-rebinding risk.
- Packaged builds use ASAR, embedded integrity validation and Electron fuses.

These are implemented mitigations, not a formal security certification.
