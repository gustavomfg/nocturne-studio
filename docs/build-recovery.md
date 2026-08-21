# Build Mode recovery

[Português do Brasil](build-recovery.pt-BR.md)

Before a Build run, Nocturne records the Git state of the authorized workspace.
Rollback is offered only when there is a `HEAD` commit, the workspace was clean,
the agent reported changed paths and every path remains contained by the
authorized root.

After explicit confirmation, versioned reported files are restored from `HEAD`
and reported new files are removed. Rollback is not offered when pre-existing
user changes make attribution unsafe. If restoration stops, the failure path and
current state remain visible for inspection; review the diff before retrying.
