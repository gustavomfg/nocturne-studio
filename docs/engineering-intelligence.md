# Engineering Intelligence

Engineering Intelligence is a local derived layer over the Project Index,
Semantic Index, Validation Pipeline, and persisted execution/change-control
state. It adds no watcher, database, or parallel suggestions system.

## Policy

`ENGINEERING_HEALTH_POLICY_VERSION = 1` identifies the policy that produced each
signal and snapshot. The engine uses deterministic structured evidence only.
Prompts, responses, raw code, secrets, vectors, and model reasoning are not
persisted in this layer.

Each `EngineeringSignal` stores a stable fingerprint, severity, evidence
quality/coverage confidence, source/run references, and the analyzed file hash
when available. Timestamps are excluded from fingerprints.

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

Completed snapshots retain policy version, source runs, categories, hashes, and
signal state/severity. `EngineeringTrendService` compares snapshots and emits
new, resolved, improved, worsened, or coverage-changed trends. Repeated
evaluations with identical state and source runs are deduplicated.

## Persistence and privacy

Data is stored in the existing SQLite database in `engineering_signals`,
`engineering_health_snapshots`, and `engineering_insights`. These are derived
and rebuildable records, so they are excluded from the user-content backup. The
named IPC group remains protected by workspace authorization.
