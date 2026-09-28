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

[Native rollback V1](native-rollback-v1.md) retains per-step journals in the
private checkpoint store and displaced entries in their acquired project parent.
An intent without confirmation remains potentially executed. These records are
manual reconciliation evidence, never authority to reopen a capability or replay
filesystem mutations automatically. Unsupported backends cannot restore bytes
through a weaker pathname fallback.

The named, read-only `recovery.list` preload capability returns up to 200 records
and startup displays them. Recovery is diagnostic, not automatic repair: a
conflicted rollback requires inspecting retained bytes and filesystem state before
any new decision. No restored workspace gains filesystem authorization through
this process. Source records and recovery entries remain workspace-scoped in SQLite.

## Owned process shutdown

Validation and Codex transport cleanup have bounded deadlines. Codex retains
cleanup ownership after its direct child exits, closes its streams, sends TERM
and escalates the owned POSIX process group to KILL after three seconds, even if
the parent already exited. Cleanup settles by four seconds and application
shutdown awaits it. Restart waits for transport cleanup rather than treating
parent exit as completion of cleanup.

This is not certification of every descendant: a descendant can escape a POSIX
group, and Windows Node supervision targets only the parent. Codex termination
diagnostics therefore explicitly retain `terminationUncertain: true`. Closing
transport streams or reaching the cleanup deadline never completes an AI turn
successfully. Startup reconciliation still records unfinished executions as
interrupted; it does not infer what external processes did after transport loss.
User-owned detached editors/terminals are not part of this cleanup.
