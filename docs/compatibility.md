# Compatibility

[Português do Brasil](compatibility.pt-BR.md)

## Official application targets

| Platform | Release artifact |
| --- | --- |
| Windows 10/11 | x64 NSIS installer |
| Linux desktop | AppImage or `tar.gz` for the published build architecture |
| macOS | DMG and updater ZIP for the published build architecture |

Only artifacts published by the automated stable-release workflow after its
validation gates are official releases. Local packages and builds for another architecture are
development artifacts until they pass the same smoke and release gates.

## Development compatibility

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- Electron 43.x;
- `better-sqlite3` 13.x with N-API, verified under the adopted Electron runtime
  and the development Node.js host.

Use `npm run test:abi` to check the packaged runtime's native module load before
running the full suite. N-API compatibility does not replace the packaged smoke.

Protected filesystem rollback has a narrower platform contract than application
startup: [V1](native-rollback-v1.md) supports local Linux tmpfs/ext4/Btrfs, macOS
APFS and Windows fixed NTFS, with conservative object/permission/size restrictions.
Other environments refuse restoration with `UNSUPPORTED`; checkpoint capture,
diff inspection and acceptance remain available. Native worker compilation also
requires the platform's C++17 toolchain; it does not change the Electron SQLite ABI.

## AI compatibility

- Codex CLI minimum: `0.145.0`;
- recommended: `0.146.0`;
- verified: `0.145.0` and `0.146.0`;
- newer versions require the successful live App Server execution contract;
- remote OpenAI-compatible endpoints require HTTPS;
- local Ollama and LM Studio endpoints use loopback.

There are no dedicated native adapters for Anthropic, Gemini or GitHub Copilot
in the current release contract. The Codex App Server remains experimental.
