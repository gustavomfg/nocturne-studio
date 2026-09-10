# Change Control — Phase 3

[Português do Brasil](change-control.pt-BR.md)

Change Control turns each Build into a persisted `Execution`. It retains the
intention, workspace, conversation, lifecycle, checkpoints, ChangeSet,
associated validations and bounded errors.

## Flow

Before a Build, the main process captures a `BEFORE` checkpoint outside the
workspace. When it ends, it captures `AFTER` and compares manifests by hash.
The comparison identifies create, modify and delete without requiring Git.
Binary files and large diffs remain structured, but are not rendered as
unbounded text.

The ChangeSet appears in Agent Mode alongside execution activity. Each file
shows its operation, observed hash, policy, diff and review state. Text hunks
have an original patch, final patch and independent state; edits are validated
against the `BEFORE` content before persistence.

## Security and index

## Decision invariants (stabilization batch 1)

File **accept** retains the observed AFTER bytes after verifying them. File
**reject** restores BEFORE through the conflict-safe rollback. Both validate
the transition, serialize by workspace, persist a running decision intent,
then verify/mutate and commit the resulting file, ChangeSet and execution
decision together. A filesystem/commit failure is a conflict, not success;
the persistent intent remains available for startup reconciliation.

Hunk **edit**, **accept** and **reject** are review annotations only. They do
not apply patches and do not decide the file. The UI labels this explicitly.
There is no effective file-edit operation in this contract. Editing in an
external editor invalidates the AFTER comparison and requires reconciliation.
An acceptance is an observation at decision time, not a lock on future edits.

SQLite and the filesystem do not share a transaction. Interrupted mutations
must remain visibly unresolved; they are never retried automatically.

Protected paths such as `.git` and `.nocturne` are blocked. Environment files,
deletions and renames require additional review. A rejection is applied only
when the file still matches the `AFTER` hash; an external edit produces a
conflict and preserves the current content.

While decisions are pending, the watcher coalesces events per workspace. The
Project Index processes that batch only after all decisions are resolved, so a
rejected proposal is not treated as effective state.

Validations continue to use the Phase 2 `ValidationPipeline`. When given an
`executionId`, the result retains that origin and can be queried as execution
evidence, including command, duration, exit code, sanitized summary and bounded
artifacts.

Embeddings, semantic search, RAG, visual graphs, multi-agent execution and
learning from history are outside this phase.
