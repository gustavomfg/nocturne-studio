# Operational recovery

On opening SQLite, one transaction classifies nonterminal executions, checkpoint
captures, validations, and index runs as failed with an explicit interruption
message. `interrupted_operations` preserves the original phase and detection time;
this is **not** evidence that the underlying task failed, nor its true finish time.
No command or filesystem restoration is resumed. Already-terminal task outcomes
are preserved.

Reserved but unfinished decisions become `interrupted`; their changes, ChangeSet,
and execution decision become conflicted. Rollback displacement journals and bytes
are retained for manual reconciliation. Pending ChangeSets restore the in-memory
decision gate. Ready checkpoints remain available; incomplete captures are not
promoted to ready. Reopening again does not duplicate interruption records.

The named, read-only `recovery.list` preload capability returns up to 200 records
and startup displays them. Recovery is diagnostic, not automatic repair: a
conflicted rollback requires inspecting retained bytes and filesystem state before
any new decision. No restored workspace gains filesystem authorization through
this process. Source records and recovery entries remain workspace-scoped in SQLite.
