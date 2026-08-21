# Nocturne Studio — Agent Instructions

## Product identity

Nocturne Studio is a local desktop Engineering Workspace for coordinating
a developer, the Codex CLI, and the state of a real software project.

It is not:

- an IDE;
- a replacement for developer judgment;
- merely a chat client;
- an official OpenAI product.

The developer retains intent, approval, judgment, and accountability.

The expected engineering loop is:

Analyze → Plan → Explain → Suggest → Approve → Implement → Validate

Do not collapse analysis, approval, implementation, and validation into one
implicit step when the existing product flow keeps them separate.

## Current release line

Current release candidate: `1.0.0` (not tagged or published yet).

Current priorities:

1. Stability and compatibility.
2. Predictable developer experience.
3. Performance on large histories and workspaces.
4. Secure and recoverable local persistence.
5. Safe cross-platform packaging and updates.
6. Explicit compatibility with supported Codex CLI versions.

The Codex App Server interface remains experimental. Do not assume that a new
Codex CLI version is compatible without explicit validation.

## Technology stack

- Electron
- React
- TypeScript
- Vite
- SQLite through `better-sqlite3`
- Zustand
- Zod
- Vitest
- Playwright
- electron-builder
- npm

Required development environment:

- Node.js `>=24.18 <25`
- npm `>=11 <12`
- WebStorm with the `webstorm` launcher available in `PATH`

Do not change the adopted Node or npm major lines without an explicit
compatibility task.

## Architectural authority

Before making architectural or security-sensitive changes, inspect the relevant
documentation under `docs/`, the README, and existing implementation.

Prefer sources in this order:

1. Accepted architecture and security documentation.
2. Current implementation and shared contracts.
3. Tests that encode expected behavior.
4. README and contributor documentation.
5. Changelog and historical notes.

If authoritative sources conflict, report the conflict instead of choosing
silently.

## Electron security invariants

These requirements must remain true unless an explicit architectural decision
changes them:

- `contextIsolation` remains enabled.
- `nodeIntegration` remains disabled.
- The renderer never accesses Node.js or Electron privileged APIs directly.
- Native capabilities cross an explicit preload/contextBridge boundary.
- IPC payloads and origins are validated.
- Privileged operations remain in the main process.
- Workspace paths are normalized and constrained before access.
- Browser permissions are denied by default.
- External navigation remains restricted.
- Authentication credentials never reach the renderer.
- Review Mode remains read-only.
- Restored workspaces remain unauthorized until explicitly reselected.
- Electron production fuses and ASAR integrity protections remain enabled.

Never expose a generic unrestricted `ipcRenderer` API to the renderer.

When changing a native capability, update together:

- shared contracts and types;
- preload surface;
- IPC handler;
- validation;
- error behavior;
- relevant tests;
- documentation when the contract is externally meaningful.

## Modes and boundaries

### Review Mode

Review Mode is analysis-only and must remain read-only.

It may:

- inspect files;
- inspect Git state;
- run safe read-only checks;
- explain findings;
- produce structured suggestions.

It must not modify the workspace implicitly.

### Build Mode

Build Mode may modify files only within the configured workspace and according
to sandbox, approval, and command-safety policies.

Generated changes are not automatically correct. Preserve visibility of:

- plans;
- activities;
- approvals;
- changed files;
- diffs;
- validation results.

### Docs Mode

Docs Mode must remain focused on documentation related to the request.

Do not use a documentation-only task as justification for unrelated source-code
changes.

## Persistence and recovery

Treat the SQLite database and workspace context as sensitive state.

When changing persistence:

- preserve transactional migrations;
- preserve rollback on invalid restoration;
- reject duplicate or inconsistent identifiers;
- avoid partial writes;
- prefer asynchronous filesystem I/O where applicable;
- use atomic writes for workspace context;
- preserve restrictive permissions;
- test migration from the previous supported schema;
- preserve existing user data unless deletion is explicitly required.

Never add databases, tokens, authentication data, private logs, or unsanitized
diagnostics to the repository.

## Performance

Performance is part of correctness.

When changing renderer behavior:

- avoid application-wide updates for streaming deltas;
- isolate frequently changing state;
- avoid unnecessary React re-renders;
- preserve lazy or viewport-based rendering for long lists;
- preserve pagination for large histories;
- keep large Git output and diffs bounded;
- avoid synchronous filesystem work on interactive paths.

When changing main-process behavior:

- avoid blocking IPC handlers;
- avoid duplicated App Server operations;
- preserve deterministic cleanup;
- handle process failure and cancellation explicitly;
- consider large workspaces, histories, backups, and diffs.

Do not claim a performance improvement without a measurement, regression test,
budget, or clearly observable reduction in work.

## UI, accessibility, and design system

Respect the existing Nocturne design language.

Preserve:

- dark visual identity;
- canonical responsive ranges;
- minimum typography and interaction targets;
- visible focus;
- keyboard navigation;
- focus containment and restoration in dialogs and drawers;
- reduced-motion behavior;
- clear async and error feedback;
- accessible status communication;
- stable geometry during hover, focus, and click.

Do not introduce isolated visual values when an existing token, component, or
design-system rule can be reused.

Visual changes should be checked at relevant canonical breakpoints. Update
screenshots only after confirming that the visual change is intentional.

## Project structure

Respect existing boundaries:

- `src/` — renderer and interface;
- `electron/` — main process, preload, IPC, native services;
- `shared/` — contracts, limits, and types shared across boundaries;
- `tests/` — unit, integration, renderer, migration, and regression coverage;
- `scripts/` — build, quality, smoke, release, and verification tooling;
- `docs/` — architecture, protocols, security, and workflows.

Before creating a module:

1. Search for an existing responsibility.
2. Reuse shared contracts and canonical limits.
3. Avoid duplicate utilities and competing abstractions.
4. Keep renderer, preload, and main-process responsibilities separate.

Do not move or rename broad areas of the project without an explicit reason and
a validation plan.

## Change discipline

Before implementing a non-trivial task:

1. Inspect the relevant implementation and tests.
2. Identify affected processes and trust boundaries.
3. Check shared contracts and documentation.
4. State assumptions and gaps.
5. Present a short plan when the change crosses multiple modules.

Prefer small, focused changes.

Avoid:

- speculative abstractions;
- unrelated cleanup;
- silent behavioral changes;
- broad rewrites without evidence;
- dependency additions when the platform or current stack already solves the
  problem;
- weakening a security boundary for convenience.

Do not modify unrelated user changes in the working tree.

## Dependencies

Before adding or replacing a dependency:

- explain why existing platform or project capabilities are insufficient;
- evaluate maintenance and security impact;
- consider package size and native-build implications;
- update the lockfile consistently;
- verify Electron and Node compatibility;
- verify cross-platform packaging when relevant.

Native dependencies require special care because Electron ABI compatibility and
packaged behavior may differ from regular Node.js execution.

## Validation

Choose validation according to the affected area.

Minimum source validation:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

# Nocturne Philosophy

When faced with multiple valid implementations:

Prefer the solution that:

- keeps the architecture clean;
- minimizes technical debt;
- improves long-term maintainability;
- respects existing project patterns.

Avoid implementing features that conflict with the long-term vision of the project.

## Git Workflow

The Git history is part of the project's documentation.

Rules:

- One logical change = one commit.
- Group related code, tests and documentation together.
- Use Conventional Commits.
- Run the relevant validations before each commit.
- Do not mix unrelated fixes.
- Do not create "miscellaneous" commits.
- Do not push or rewrite history unless explicitly requested.
