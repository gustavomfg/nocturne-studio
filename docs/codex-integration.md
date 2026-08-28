# Codex CLI integration

[Português do Brasil](codex-integration.pt-BR.md)

Nocturne Studio integrates with the Codex CLI through its App Server.

- minimum supported CLI: `0.145.0`;
- recommended CLI: `0.146.0`;
- verified versions: `0.145.0` and `0.146.0`.

## Authentication and compatibility

Authenticate with the Codex CLI using the account flow appropriate for your
installation. Nocturne checks the executable version, authentication state and
the live App Server contract. Startup includes a protocol handshake and safe
`config/read` probe; model discovery uses `model/list`. A version below the
minimum, missing authentication or an incompatible response is reported as a
recoverable diagnostic rather than treated as a usable provider.

Newer versions do not require a dependency edit, but they must pass the runtime
handshake. The App Server interface is experimental.

## Conversations and modes

The returned model list is filtered to the account and the selected model is
sent explicitly when a thread and turn start. Codex threads can be resumed with
the current workspace roots and policies. Cancellation uses the exact thread
and turn identifiers. Only one active agent execution is allowed at a time.

Review uses a read-only sandbox. Build uses a workspace-write sandbox limited to
the authorized root, disabled network access and user approvals. Docs uses the
read-only generation path and applies Markdown through Nocturne's preview and
confirmation boundary.

## Real Build contract smoke

The authenticated contract smoke also exercises a real Build session against
the installed Codex CLI. It creates a temporary Git workspace and:

- accepts a write approval only when the expected file is inside the workspace,
  then verifies its exact contents;
- attempts a write to a separate external sentinel and declines or verifies the
  sandbox rejection without allowing the sentinel to change;
- starts a network attempt with `networkAccess: false` and requires the
  restriction or approval denial to be observed;
- starts a long-running Build command, interrupts it using its exact thread and
  turn identifiers, and requires an interrupted terminal state;
- requires both temporary directories to be removed and the App Server to exit
  cleanly.

The report contains only sanitized states and counters. A successful report is
not release evidence unless its repository SHA, Codex version and workflow run
also match the candidate being released.

## Failure behavior

If the CLI is absent, unauthenticated, incompatible, times out or exits, the
operation ends with a visible error and cleanup. The renderer never receives
Codex credentials or a generic process transport. Use **Settings > AI >
Diagnostics** for a sanitized report.
