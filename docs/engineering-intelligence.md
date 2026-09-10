# Engineering Intelligence

Engineering Intelligence is a local derived layer over the Project Index,
Semantic Index, Validation Pipeline, and persisted execution/change-control
state. It adds no watcher, database, or parallel suggestions system.

## Policy

`ENGINEERING_HEALTH_POLICY_VERSION = 2` identifies the policy that produced each
signal and snapshot. The engine uses deterministic structured evidence only.
Prompts, responses, raw code, secrets, vectors, and model reasoning are not
persisted in this layer.

Each `EngineeringSignal` stores a stable fingerprint, severity, evidence
quality/coverage confidence, source/run references, and the analyzed file hash
when available. Timestamps, evidence details, exit codes, and severity are
excluded from the fingerprint identity. A severity change therefore updates
the same signal and can produce an `improved`/`worsened` trend instead of
inventing a new issue. `confidence` is an evidence-quality percentage, not a
calibrated probability.

## Coverage

Health categories are `architecture`, `testing`, `security`, `documentation`,
`dependencies`, `performance`, `developer-experience`, and `release`. Every
category reports `assessed`, `partial`, or `not-assessed`. Missing tests,
documentation, parsers, providers, or telemetry are not failures. The first
implementation has no global score, so uncovered categories cannot distort
other categories.

Semantic retrieval remains context retrieval. Its `vector`, `lexical`,
`structural`, `dependency`, and `final` scores are not health metrics.

## Correlation and history

`EngineeringCorrelationService` records only observable co-occurrences between
active signals. Insights explain when a relationship is not causal proof and
retain the related evidence. They live in the Engineering Intelligence
repository; the existing Suggestions/Review Mode remains the boundary for
proposals that require a user decision.

Validation evidence is reduced to the newest run for each equivalent request
(kind, resolved command, and arguments); older runs remain in the validation
history and source references. A missing comparable run never resolves a
historical signal. A stale `WorkspaceStateManifest` cannot resolve or create a
current validation finding; an unknown manifest is retained explicitly as
`validity: "unknown"` and makes the testing category `partial`. This records
the command result without claiming that the entire workspace was a consistent
snapshot. Insights are reconciled only when every related signal is resolved or
is present in the current evaluation; a missing comparable validation therefore
leaves the old insight active.

The correlation for multiple validation failures counts distinct validation
types, not exit codes or repeated records of one command.

Completed snapshots retain policy version, source runs, categories, hashes, and
signal state/severity. `EngineeringTrendService` compares snapshots and emits
new, resolved, improved, worsened, or coverage-changed trends. Repeated
evaluations with identical state and source runs are deduplicated.

## Persistence and privacy

Data is stored in the existing SQLite database in `engineering_signals`,
`engineering_health_snapshots`, and `engineering_insights`. These are derived
and rebuildable records, so they are excluded from the user-content backup. The
named IPC group remains protected by workspace authorization.
