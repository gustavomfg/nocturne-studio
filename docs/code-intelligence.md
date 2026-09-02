# Code Intelligence — Phase 2

[Português do Brasil](code-intelligence.pt-BR.md)

Code Intelligence keeps a local structural view of the workspace. It is not an
IDE, does not perform semantic embedding search, and does not create a visual
dependency graph in this phase.

## Pipelines

The main process separates three responsibilities:

1. `WorkspaceDiscoveryService` discovers files, configuration, exclusions and
   missing paths without depending on a language;
2. `ProjectIndexService` computes hashes, selects a `ParserAdapter`, persists
   metadata/symbols/relations and publishes progress;
3. `ValidationPipeline` selects a stack-backed validation and records its
   structured result.

The existing Chokidar watcher remains the event source. After the initial
index, a file event uses partial discovery and reprocesses only the affected
file or directory. Overflow or manual reindex uses full reconciliation. Events
received during a run are coalesced in a per-workspace queue.

## Persisted index

SQLite stores `project_index_runs`, `project_index_files`,
`project_index_symbols`, `project_index_imports`, `project_index_exports`,
`project_stack_evidence` and `project_index_exclusions`. Each derived result
keeps the analyzed hash of its source file; stack evidence keeps the hash of the
file supporting the conclusion. The current structural version is
`CODE_INTELLIGENCE_INDEX_VERSION`.

Read or parse failures are recorded on the corresponding file and do not stop
other files. Retry selects only failed files. Reindexing replaces relations and
evidence transactionally, without storing raw source contents.

## Languages and relations

Parsers implement the common contract in
`electron/project-index/ParserAdapter.ts`. The current adapter uses the
TypeScript API for TypeScript and JavaScript, including functions, classes,
interfaces, types, enums, methods, components, imports and exports. New
adapters can be added to `ParserRegistry` without changing the SQLite model.

Imports and exports record paths, hashes, specifiers, locations and local,
external or unresolved resolution. The model remains independent from the AI
and does not render a graph.

## Stack and validation

The detector records every conclusion as evidence with category, confidence,
file, hash, line when available and a reason. Package managers, scripts,
runtimes, languages, frameworks, bundlers, lint/typecheck tools, test tools and
build tools are inferred only from files found in the workspace.

The pipeline offers typecheck, lint, tests, build and smoke when a script or a
supported stack fallback exists. Commands start in the main process, inside the
authorized workspace, without a generic Nocturne shell; output is bounded and
sanitized, and artifacts are persisted only when they resolve to existing files
inside the workspace. Missing commands or destructive risk produce `blocked`
status instead of an implicit execution.

## AI and observability

Structural context sent to the AI contains the index run, version, summary,
selected files/symbols, relations, evidence, hashes and an outdated marker.
Persisted Awareness selections point to the run and the file/symbol used.

The sanitized Diagnostics report exposes aggregate counts and timings for
indexing, incremental updates, parsers, cancellations, partial failures and
validation. Embeddings, external synchronization and advanced execution
history are outside this phase.
