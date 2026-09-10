# Workspace evidence identity

`workspace_evidence` associates a bounded, immutable `WorkspaceStateManifest` with
an observation, not a global filesystem version. It contains no source text,
embeddings or credentials. Existing source records remain authoritative.

| Observation | Identity retained |
| --- | --- |
| Context assembly | Execution ID, selected source IDs, SHA-256 of the actual budgeted source content, semantic source hashes, consumed structural run ID |
| Project Index | Run ID and known analyzed hashes at the terminal database observation |
| Semantic Index | Run ID and known unit source hashes at the terminal database observation |
| BEFORE / AFTER | Checkpoint ID, known existence and hashes; ready state and evidence commit together |
| Validation | Run ID, execution ID, index/checkpoint references available at scheduling |
| Decision | Durable operation ID, BEFORE/AFTER references, expected resulting hash; commits with the final decision |
| Engineering Intelligence | Snapshot ID and the exact run/execution/ChangeSet source IDs recorded by the engine |

Every manifest declares `consistency: non-atomic` and `coverage: known-paths-only`.
`startedAt`/`observedAt` delimit application observations, not a transactional
snapshot or the exact time files changed. For indexes, hashes describe cached
analysis. For validation, references are **not proof of its actual read set**;
`passed` still describes command exit status, not current workspace validity.
Legacy/missing evidence is explicitly unverified; startup does not fabricate it.

## Currency and staleness

- `unknown` is the default global validity, including after restart. There is no
  implicit `valid` state based on an idle watcher or a passed command.
- The context boundary checks at most 200 known paths, at most 2 MiB per file,
  using the constrained workspace reader. Missing/changed known content marks
  that observation stale. Inaccessible, oversized, or unsampled paths remain
  unchecked. Matching samples never certify global currency.
- Verification retains its timestamp and matched/mismatched/unchecked counts.
- Filesystem notifications conservatively invalidate existing workspace
  observations, including watcher overflow. They are processed before the
  Change Control notification gate. This can invalidate evidence whose own
  files did not change; it is a loss of currency assurance, not deletion of history.
- A reference to stale evidence makes its dependent evidence stale when read.
  Detection time and reason are retained separately from immutable observations.
- No observation is silently refreshed under the same identity. Returning bytes
  to an earlier hash does not erase an earlier invalidation.

The manifest stores at most 2,000 known paths and 500 references, with explicit
truncation. Full checkpoint manifests remain in their existing repository.
The named `evidence.list` IPC validates conversation ownership and returns up to
20 records, following available references within that workspace. Its lazy
renderer panel shows unknown/stale, source IDs and hashes, at most 20 paths per
record. Refreshing records is not a new full filesystem verification.

## Deliberate limits

There is no global workspace lock, consistent multi-file snapshot, tracing of
Codex/tool reads, or proof against arbitrary writes after the last observation.
Mutations while the app is closed may remain unknown until a relevant check or
notification. Staleness does not rewrite historical task outcomes or health
scores. This ledger makes their provenance limitations visible; it does not
retroactively improve the original evidence. Retention follows execution and
workspace deletion; no automatic pruning of retained execution evidence was added.
