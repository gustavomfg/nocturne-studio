# Code Intelligence — Phases 2 and 4

[Português do Brasil](code-intelligence.pt-BR.md)

Code Intelligence keeps a local structural and semantic view of the workspace.
It is not an IDE and does not create a visual dependency graph. Semantic
embeddings are optional and remain a retrieval aid, not an architectural
recommendation system.

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

Discovery applies structural exclusions to every normalized path segment, so
nested `node_modules`, build output and other generated directories are not
walked accidentally. The watcher uses the narrower workspace policy (it keeps
`.nocturne` observable for workspace memory and evidence), while project
discovery and checkpoints use the project policy. These are deliberate domain
boundaries; neither policy interprets `.gitignore` today. `maxFiles` is a
storage budget and `maxTraversalEntries` is a separate work budget. A truncated
walk records which budget was hit and never treats unvisited paths as proven
deletions.

## Persisted index

SQLite stores `project_index_runs`, `project_index_files`,
`project_index_symbols`, `project_index_imports`, `project_index_exports`,
`project_stack_evidence` and `project_index_exclusions`. Each derived result
keeps the analyzed hash of its source file; stack evidence keeps the hash of the
file supporting the conclusion. The current structural version is
`CODE_INTELLIGENCE_INDEX_VERSION`.

The service reads and hashes a discovered file before reusing its derived rows.
Reuse additionally requires the same parser identity/version. A structural
version change forces a full derived rebuild. During an incremental event, an
unchanged importer is reprocessed when a newly created/deleted/renamed target
can change relative resolution; target hashes are refreshed only after the
corresponding file rows are persisted. A source event therefore does not rely
on metadata such as size and mtime as proof of unchanged bytes.

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
external or unresolved resolution. Their derived identity is scoped by
workspace both in the stable id and in the SQLite primary key, so identical
clones can coexist in one local database. The model remains independent from
the AI and does not render a graph.

## Stack and validation

Validation history is loaded in pages of 20 runs. Use “Load earlier
validations” to browse older results; each query remains scoped to the
authorized workspace.

The detector records every conclusion as evidence with category, confidence,
file, hash, line when available and a reason. Package managers, scripts,
runtimes, languages, frameworks, bundlers, lint/typecheck tools, test tools and
build tools are inferred only from files found in the workspace.

The pipeline offers typecheck, lint, tests, build and smoke when a script or a
supported stack fallback exists. Commands start in the main process, inside the
authorized workspace, without a generic Nocturne shell; output is bounded and
sanitized, and artifacts are persisted only when they resolve to existing files
inside the workspace. Missing commands or destructive risk produce `blocked`
status instead of an implicit execution. A workspace still has one active
process slot, but deduplication is limited to requests with the same kind,
resolved command/arguments and execution identity; a different request is
rejected explicitly instead of receiving the first request's result.

## Semantic Index — Phase 4

`SemanticChunker` derives stable units from Project Index symbols, Markdown
sections, configuration files and bounded text. `SemanticIndexService` consumes
those units without introducing another watcher or discovery pass. Each unit
keeps its file hash, chunk hash, chunk strategy version, location and status.

Vectors are stored as local Float32 BLOBs in SQLite. The embedding space is
identified by provider, model, model version and dimensions; vectors from
different spaces are never compared. A workspace must bind an explicit
`embeddingBinding`, separate from its chat `defaultBinding`. Without a valid
embedding binding, or when a Provider fails, the index remains usable through
lexical and structural retrieval.

Privacy is evaluated before content is sent to an embedding adapter. Excluded,
secret-like, asset and unsupported files are not read into the semantic
pipeline. Remote embeddings require explicit workspace consent and receive no
content when that consent is absent. Hashes are rechecked before and after an
asynchronous embedding request; stale work is discarded and queued again.

Retrieval normalizes lexical, vector, structural and shallow dependency signals
before combining them. `ContextAssemblyService` applies source priority,
deduplication, token limits and provenance. Results exposed to the AI include
the source path, analyzed hash, chunk hash, index version and retrieval reason.
Every candidate first passes the Project Index hash/state gate, including FTS
and dependency-expanded candidates. The bounded top-candidate window then
checks the actual file bytes; results carry `validity: "current"`, `"stale"`,
or `"unknown"`. Stale candidates are dropped, while unknown I/O is exposed as
potentially outdated. This is a relevant-scope check, not a claim that the
whole workspace was an atomic snapshot.

Vector top-k is selected after scoring and global path/language/kind/symbol
filters are applied to every candidate source. Dependency evidence is a
supporting boost, not a probability, so a dependency-only candidate cannot be
renormalized to score 1. Chunk locations refer to the original file offsets,
including split chunks. Awareness provenance is produced only for sources that
survived context assembly and were serialized; `estimatedTokens` remains the
documented four-characters-per-token estimate, not a provider hard limit.
The current chunk strategy is `symbols-v2`; older persisted units are rebuilt
when they are next encountered.

Renderer index/search and Change Control requests carry workspace, execution,
session-generation or request identity. A late response is discarded when its
identity is no longer current, including after unmount or a newer search.

## AI and observability

Structural context sent to the AI contains the index run, version, summary,
selected files/symbols, relations, evidence, hashes and an outdated marker.
Persisted Awareness selections point to the run and the file/symbol used.

The sanitized Diagnostics report exposes aggregate counts and timings for
structural indexing, semantic indexing, incremental updates, parsers,
cancellations, partial failures and validation. External synchronization,
visual dependency graphs, architectural suggestions, multi-agent execution,
diff approval, checkpoints and advanced execution history remain outside these
phases.
