# Architecture

[Português do Brasil](architecture.pt-BR.md)

Nocturne Studio is an Electron desktop workspace. The renderer presents state
and requests operations; it does not receive Node.js, Electron, credential or
direct filesystem access.

## Processes and boundaries

- `src/` is the React renderer.
- `electron/preload.ts` exposes named, typed methods through `contextBridge`.
- `electron/ipc/` validates origin, payload, rate limits and workspace
  authorization before native work begins.
- The Electron main process owns SQLite, files, Git, Providers and the Codex App
  Server.
- `shared/` contains contracts and limits shared by the two sides.

The BrowserWindow uses `contextIsolation: true`, `sandbox: true` and
`nodeIntegration: false`. External navigation is denied; permitted HTTPS links
are opened by the operating system.

## AI execution

Codex CLI/App Server is used for the account-based path and for Build and Docs.
Review uses read-only policies. Build uses a workspace-scoped write policy,
explicit approvals and disabled network access for the agent sandbox.

OpenAI-compatible providers use a separate adapter contract for model discovery,
streaming, cancellation, bounded responses and diagnostics. Tool calling is not
normalized by that adapter. Provider credentials remain in the main process.

## Local state

SQLite stores conversations, messages, settings, model catalogs, bindings,
suggestions and structured knowledge. Migrations are transactional and the
database uses WAL with `synchronous=FULL`. Workspace context files are bounded
and written atomically. Backups use a versioned envelope and checksum; restore
creates a local snapshot first.

Restored workspaces are not authorized automatically. The active workspace is
watched through a single Chokidar backend with ignored generated directories,
bounded reconciliation and debounced semantic change events.

## Trust model

The developer controls provider selection, workspace authorization, approvals,
review decisions and final changes. Persistent memory is treated as untrusted,
possibly stale data rather than executable instructions.
