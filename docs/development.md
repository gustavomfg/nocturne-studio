# Development

[Português do Brasil](development.pt-BR.md)

## Environment

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- Codex CLI minimum `0.145.0`; recommended `0.146.0`;
- WebStorm is recommended and the `webstorm` launcher should be available in
  `PATH`;
- native tooling compatible with the Electron ABI and `better-sqlite3`.

## Daily commands

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Additional validation:

```bash
npm run test:abi
npm run test:renderer
npm run benchmark:sqlite
```

`npm run test:renderer` runs Playwright. `npm run test:abi` verifies the native
SQLite module inside the adopted Electron runtime.

## Packaging and smoke checks

```bash
npm run package -- --publish never
npm run package:dir -- --publish never
npm run smoke:package
npm run rehearse:packaged-recovery
```

The rehearsal commands use isolated temporary data and are release-engineering
checks, not a replacement for signed release validation. `npm run smoke:codex`
requires an authenticated Codex installation and should be run only in the
authorized compatibility workflow.

Run `git diff --check` before submitting a change. Keep tests, contracts,
preload APIs and documentation aligned when changing a native capability.
