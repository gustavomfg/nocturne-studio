# Backup, restore and recovery

[Português do Brasil](backup-and-recovery.pt-BR.md)

## Export and import

Use **Settings > Data and diagnostics > Export backup**. The export is a
versioned envelope with a SHA-256 checksum and does not include provider
credentials or project files.

Before an import changes the database, Nocturne validates size, structure,
checksum, schema compatibility, duplicate identifiers and relationships. A
local snapshot is created first; the import is transactional and rejects an
invalid payload. Full restore replaces exportable application data. Partial
restore replaces project, conversation, artifact, suggestion and memory data
while keeping this installation's provider configurations, model catalog and
preferences.

Restored workspaces are deliberately unauthorized. Select the corresponding
folder again before Git, memory or AI operations can access it.

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
system credential vault. Keep project backups or a remote Git repository under
your own policy. Do not copy provider secrets into a backup to make it portable.
