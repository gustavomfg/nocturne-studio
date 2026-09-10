# Build Mode recovery

[Português do Brasil](build-recovery.pt-BR.md)

Build rollback uses the private immutable BEFORE/AFTER checkpoints. It does not
read a mutable Git HEAD or reset the Git index. Existing user changes are part
of BEFORE and are preserved.

After explicit confirmation, each target must match AFTER, including mode and
bytes. Displaced files are retained under `.nocturne/rollback/<operation>` with
an operation journal. A restored file is published exclusively: it never
replaces a competing newly created path. A conflict or partial failure preserves
the displaced bytes and reports the recovery directory. Delete and rename are
restored through their file-level BEFORE/AFTER manifests.

This is not a filesystem-wide transaction. External programs can retain open
descriptors to displaced files; those files are deliberately retained. On a
conflict, inspect both the workspace and recovery directory. No automatic
continuation of an interrupted rollback is implied.

The confirmation is bound to an execution ID. The produced path is checked
again before reporting restoration, including the expected absence of a newly
created file. A successful whole-Build rollback resolves its pending decision
gate and publishes the durable ChangeSet update to the renderer.
