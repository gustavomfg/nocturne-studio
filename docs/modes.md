# Review, Build and Docs modes

[Português do Brasil](modes.pt-BR.md)

## Review Mode

Review is analysis-only. It reads the authorized workspace and produces
structured suggestions with evidence, confidence, source, severity, rationale
and decision history. A later review reconciles new and persistent findings and
resolves open findings no longer supported by current evidence. Review never
changes project files by itself.

## Build Mode

Build can modify files only inside the authorized workspace and under the active
approval and sandbox policy. The Codex App Server receives a workspace-write
policy with network access disabled. Progress, requested approvals, changed
files and diffs remain visible.

Guarded rollback is available only when the workspace was clean before the run,
there is a `HEAD` commit and the agent reported paths that remain within the
authorized root. Review the current diff before confirming a rollback.

## Docs Mode

Docs generates proposals read-only. The user selects a Markdown file, compares
the current and proposed content, then confirms append, replace or create. The
hash is checked again before writing, and the write is atomic. HTML, DOCX and
PDF exports are derived copies and are not incremental source-document updates.

Advanced autonomous build, documentation and orchestration features are outside
the current 1.0 contract.
