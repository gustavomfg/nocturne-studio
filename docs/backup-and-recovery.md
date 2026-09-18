# Backup, restore and recovery

[Português do Brasil](backup-and-recovery.pt-BR.md)

## Export and import

Use **Settings > Data and diagnostics > Export backup**. The export is a
versioned envelope with a SHA-256 checksum and does not include provider
credentials or project files.

This is a **content backup**, not operational recovery or a forensic archive.
It contains workspaces, conversations and messages, artifacts, the database
workspace-memory mirror, Brain memories and their history, suggestions and
their decisions, plus non-secret Provider/model/binding configuration and
settings. It does not contain executions, approval audit entries, validation
runs, ChangeSets, checkpoints or their private rollback bytes, execution
commands/errors/validation links, interrupted-operation records, or workspace
evidence manifests. Project, semantic, and Engineering Intelligence data are
derived and are also outside this portable content contract.

Before an import changes the database, Nocturne validates size, structure,
checksum, schema compatibility, duplicate identifiers and relationships. A
local snapshot is created first; the import is transactional and rejects an
invalid payload. Full restore replaces exportable application data. Partial
restore replaces project, conversation, artifact, suggestion and memory data
while keeping this installation's provider configurations, model catalog and
preferences.

Restored workspaces are deliberately unauthorized. Select the corresponding
folder again before Git, memory or AI operations can access it.

Restore does not represent omitted operational records as restored or
recoverable. Foreign-key cascades remove local records attached to the content
being replaced; unrelated local operational data is not merged into the backup
as if it had been exported. The pre-restore local database snapshot is the
recovery point for the installation being replaced.

## Database recovery

SQLite integrity is checked at startup. Before migrations, the application
checks the database, checkpoints WAL, creates a restricted pre-migration copy
and retains the most recent candidates. A corrupt database is preserved in a
quarantine directory. A valid compatible candidate can be restored only after
the user confirms the native recovery dialog. If no valid candidate exists,
startup fails without silently creating an empty replacement.

The recovery engine validates candidates before offering them and preserves the
original database and its WAL/SHM artifacts when possible. A recovery artifact
or failed permission check is not treated as a successful database.

## What to keep separately

Backups do not contain the project's source files, Git history or operating
system credential vault. This includes `.nocturne/memory.md` and
`.nocturne/rules.md`: they are project files, outside the portable backup, even
though `workspace_memory` has a separate application-data mirror. Keep project
backups or a remote Git repository under your own policy. Do not copy provider
secrets into a backup to make it portable.
