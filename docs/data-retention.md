# Data retention and recovery boundaries

[Português do Brasil](data-retention.pt-BR.md)

Nocturne does not currently apply a global age-based garbage collector or a
global disk budget. That is deliberate: a completed Build can still be eligible
for user-initiated rollback, and deleting its BEFORE/AFTER data by age would
silently change that guarantee. The absence of a GC is not a claim of unlimited
storage.

## Retention policy today

| Data class | Retained guarantee | Backup guarantee | GC eligibility |
| --- | --- | --- | --- |
| Active execution, pending ChangeSet, checkpoint and interrupted operation | Preserve while pending, conflicted, capturing, or needed to reconcile recovery. | Not in content backup. | Never automatically. |
| Execution audit, validation result, workspace evidence and decision history | Retained locally while the owning workspace/conversation exists. | Content backup preserves suggestions and decisions only. | No time-based GC. Delete only through ownership deletion/cascade. |
| Authored workspace/Brain memory | Retained until the user edits or deletes it, or deletes its owner. | Database mirrors and Brain history are included; `.nocturne` files are outside the portable backup. | Never automatically. |
| Review conversation, messages, artifacts, suggestions and decisions | Retained while the conversation exists; future Review reconciliation is scoped to that conversation. | Included as content. | No time-based GC. |
| Project/Semantic/Engineering Intelligence | Derived and rebuildable; per-file index rows are replaced as the workspace changes. | Excluded. | Eligible for an explicit future derived-data policy, but no automatic pruning is implemented. |
| Logs and local recovery snapshots | Log rotation keeps the current 2 MB log plus one rotated file; pre-restore snapshots retain five and pre-migration copies retain three. | Not in content backup. | Bounded by their specific mechanisms. |

Each checkpoint is also bounded to 32 MB per file and 512 MB total. Those are
capture safety limits, not a workspace-history budget. The filesystem is the
current observability path for accumulated database and checkpoint storage;
Nocturne does not yet expose or warn at a product-wide disk threshold.

## Implications for Review history

The product retains the Review history that remains in its database and exports
its content entities. It does not promise a complete temporal archive across a
database reset, deletion, or content restore, and `.nocturne/memory.md` is not
a substitute for the original Review, evidence, or suggestion identity. Git
records workspace changes, not the complete review evidence that motivated
them.

A future retention feature must first expose a user-visible policy and preserve
all data reachable from pending decisions, rollback/recovery operations, and
unreconciled interruptions. It must delete database rows and private checkpoint
bytes atomically enough to avoid dangling recovery references.
