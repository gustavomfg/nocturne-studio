# Awareness

[Português do Brasil](awareness.pt-BR.md)

Awareness is the explainable selection of context for an execution. Nocturne
considers only active memories compatible with the current workspace or
conversation, scores textual relevance, approved confidence, scope and
freshness, and applies quantity and character limits.

The selected-context snapshot is persisted with the user message. In
**Activity > Context used in this run**, the user can inspect the selected
memory/context, relevance, reason, source, scope, update time and the bounded
excerpt actually sent. A previous snapshot remains an audit record; it is not
silently reused as the current context.

When available, the snapshot also identifies `project-index` selections:
evidence files and symbols include the index run, version and analyzed hash. If
a filesystem change is waiting to be processed, the context is marked as
potentially outdated.

Snapshots follow conversations through valid export and restore. They contain
no credentials and are passed as data that may be stale, not as executable
instructions.
