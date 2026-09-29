# Protected rollback V1

This describes the implemented boundary, not a filesystem transaction or an OS
sandbox. It deliberately does **not** prove continuous membership in the current
workspace pathname tree. An acquired directory can be moved by another process;
an already-issued operation can affect that same directory before the loss is
observed. Once structural loss is known, no further workspace mutation is admitted.

## Availability

| Backend | V1 behavior |
| --- | --- |
| Linux, local tmpfs/ext4/Btrfs | Native capability-based operations; missing kernel/filesystem primitives fail closed |
| macOS | `UNSUPPORTED`; no named-source staging or pathname fallback |
| Windows, local fixed NTFS | Handle-relative backend implemented on the stabilization branch; real-platform verification pending |
| Other filesystems/platforms | `UNSUPPORTED`; no copy/delete fallback |

These are feature restrictions, not certification of all Linux filesystems.
The application can still capture BEFORE/AFTER, inspect diffs and accept changes
on unsupported backends. Whole-Build rollback reports unavailable; rejecting a
file that requires restoration fails explicitly, preserves bytes and records a
conflicted decision. Manual recovery from checkpoints remains necessary there.
Restoring missing directory hierarchies, symlinks, special files, mount crossings,
special permission bits and files larger than 32 MiB is not supported.

## Native worker

A small C++17 executable is built locally (`npm run build:boundary`) and packaged
as `resources/native-boundary/rollback-boundary[.exe]`, outside ASAR. No Node ABI
binding or new package dependency is used. Development requires g++ on Linux,
Apple clang on macOS or MSVC Build Tools on Windows. Darwin currently implements
only the fail-closed response. Production never compiles or downloads a worker.

Only the main process starts this trusted executable, with `shell: false` and a
minimal environment. The renderer receives no native handle or generic filesystem
API. One worker owns one bounded rollback operation, including its root, current
parent, observed file, anonymous staging file and journal descriptors. Commands
are serialized. A lost response/transport or 15-second command deadline means
`UNKNOWN`; shutdown closes workers with a bounded one-second grace interval.
Shutdown also advances an in-memory admission epoch and disposes the service
owner. File/whole-Build requests retain the epoch captured before queueing or
asynchronous preparation. They cannot start a new helper after cleanup overtakes
them. The epoch is a lifecycle cutoff, not a persisted filesystem capability.

Linux root/parent acquisition uses `openat2` beneath/no-symlink/no-magic-link
constraints; parents additionally disallow mount crossings. Mutations use retained
directory descriptors and single entry names. Fresh pathname observations can
revoke authority but cannot replace retained capabilities. Root/parent substitution
therefore cannot redirect a mutation to a newly substituted directory.
Read-only root custody spans asynchronous preflight and all decisions of a
whole-Build rollback; native acquisition must match that still-retained object.
A replacement with identical AFTER bytes is not a newly authorized root. The
retained descriptor also prevents identity recycling during this preparation.

New content is written to an anonymous `O_TMPFILE` descriptor, not a named private
stage. Publication selects that descriptor through `/proc/self/fd` and `linkat`;
this descriptor reference is not a reusable project pathname. No named-source
fallback or privileged `AT_EMPTY_PATH` fallback exists. Existing targets are
displaced with `renameat2(RENAME_NOREPLACE)` and inspected; publication is exclusive.
Displacement is **not** source-inode compare-and-swap. If a competing entry wins
that race, it is retained and the operation conflicts rather than publishing
BEFORE or deleting the competitor. Nothing is restored/truncated/chmodded in place.

## Retention, outcomes and recovery

Windows uses component-by-component `NtCreateFile` rooted at a retained drive/
directory handle, rejects reparse traversal and publishes/displaces through
`NtSetInformationFile(FileRenameInformation)` with replacement disabled. These
Native API entry points are resolved from the system ntdll, with no pathname
fallback. Separate read-only custody workers keep roots alive through async
preparation; IDs alone are not custody. Handles allow delete sharing: no universal
pinning is claimed. Staging has an exclusive diagnostic name, but rename selects
the retained source HANDLE, never that name. Unpublished artifacts are retained;
there is no delete-on-close/name-based compensation. Windows mode support is
limited to writable regular content (Node's emulated 0666); unsupported permissions
fail before displacement. File flush acknowledgment is not namespace/power-loss
certification.

Displaced entries stay in their acquired parent as
`.nocturne-rollback-<operation>-<file>.after`. This avoids cross-volume copy/delete
and preserves external hardlink aliases. They are excluded from indexing,
checkpoint capture and watcher notifications. They are not automatically deleted
on success or failure. No automatic retention/GC policy is introduced here.

An ordered `steps.jsonl` and diagnostic `operation.json` live in the private
checkpoint store's `rollback/<operation>` directory, separate from project paths.
The operation records intent before displacement/publication, verification after
each file, retained entry labels and the observed outcome. A failed journal write
prevents the next mutation. Snapshot writes can be incomplete on crash; the
append journal is retained. File/directory fsync acknowledgments are not a
power-loss certification.
The append log stores compact per-step observations, not repeated cumulative
snapshots. Entries are limited to 64 KiB and the diagnostic snapshot to 1 MiB;
exceeding a journal budget aborts further mutations rather than dropping evidence.

Only individually verified files appear in `restored`. A later conflict preserves
earlier restorations as partial work; no automatic compensation or destructive
pathname cleanup runs. `CONFLICT`, `REVOKED`, `UNSUPPORTED` and `UNKNOWN` all map
to non-successful decisions. Filesystem verification does not commit SQLite:
decision persistence can still fail, in which case the decision remains conflicted.
Rollback invoked by Change Control records the reserved decision-operation,
change and ChangeSet IDs in each journal step. A native journal's `restored`
status describes filesystem verification only; consult the linked SQLite
decision operation for decision persistence. A lost commit acknowledgment is
not a successful decision and does not grant authority to compensate.
An intent without confirmation means **possibly executed**, not "not executed".

Restart does not replay a worker, numeric descriptor, file identity or path.
Startup decision reconciliation remains conservative; the journal and retained
bytes are evidence for manual reconciliation, not reusable authority. JSON content
backup does not include these rollback bytes or operational journals.

## Threat-model limits

Project-path substitution and ordinary non-cooperative concurrency are covered
within the supported operations. There is no guarantee of global atomicity,
continuous current-path membership, immutable future bytes, or control over
another process's existing writable descriptors/hardlink aliases. Main-process
compromise, tampering with private application/checkpoint state, hostile procfs or
filesystem/kernel behavior and privileged adversaries are outside this boundary.
The macOS private-named-source strategy rejected during research is not used.

Tests distinguish Linux real-filesystem restoration from macOS/Windows real-platform
fail-closed behavior. A passing unsupported-backend test is not a working rollback
certification. Protected backend support must be added and tested before lifting
any platform restriction; unsupported operations must never silently fall back.
For targeted local filesystem verification, set `NOCTURNE_NATIVE_TEST_ROOT` to an
explicitly created disposable directory and run the native/snapshot tests. Fixtures
are created beneath it; no existing files are used as rollback targets.
