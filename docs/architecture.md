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

Code Intelligence reuses this watcher through three separate pipelines:
`WorkspaceDiscoveryService` discovers language-agnostic scope,
`ProjectIndexService` processes only necessary files through parser adapters,
and `ValidationPipeline` runs checks selected from stack evidence. The index
is stored locally with per-file hashes, structural relations and partial
failures; it does not depend on the AI provider.

## Runtime and code organization

The renderer application shell in `src/App.tsx` is intentionally a composition
boundary. Bootstrap, theme transitions, notices and settings preloading live in
`src/domains/app/`; conversation actions, turn metadata restoration and chat
viewport behavior live with the chat domain. This keeps navigation and layout
composition separate from stateful effects and domain rules.

The agent inspector is split between the navigation container in
`src/domains/agent/AgentPanel.tsx` and the activity surface in
`src/domains/agent/AgentActivityPanel.tsx`. The container subscribes only to
tab counts and the running indicator; activity data, rollback, document export,
Git and approval history remain in the activity surface. The activity surface
is kept mounted while tabs change so local dialog and rollback state is not
discarded.

The main process composes the application lifecycle and keeps packaged
diagnostic harnesses in `electron/runtime/PackageSmoke.ts` and
`electron/runtime/PackagedRecoveryHarness.ts`. The harnesses receive their
window and database dependencies explicitly, so packaging checks do not become
additional bootstrap responsibilities.

`DatabaseRuntime` owns the SQLite connection, migrations, recovery snapshots,
integrity maintenance and operation timing. `DatabaseRepositories` composes
the domain repositories around that connection, while critical repository
transactions use a named runtime-owned transaction runner. `Database.ts`
remains a compatibility façade for the main process and does not issue raw
audit SQL directly.

IPC registration is composed by domain modules under `electron/ipc/`; the
shared `IpcChannel` contract limits the safe registrar to channels declared in
`shared/ipc/channels.ts`. The renderer keeps high-frequency execution state in
Zustand and reports aggregate render, long-task and operation metrics without
including prompt or file contents. Components that need only a derived value,
such as the pending approval notice, subscribe to that value rather than to
the complete collection. Render counters use a renderer-level diagnostic
registry so lazy-loaded domain chunks contribute to the same aggregate report.

## Trust model

The developer controls provider selection, workspace authorization, approvals,
review decisions and final changes. Persistent memory is treated as untrusted,
possibly stale data rather than executable instructions.
