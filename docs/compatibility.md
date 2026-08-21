# Compatibility

[Português do Brasil](compatibility.pt-BR.md)

## Official application targets

| Platform | Release artifact |
| --- | --- |
| Windows 10/11 | x64 NSIS installer |
| Linux desktop | AppImage or `tar.gz` for the published build architecture |
| macOS | DMG and updater ZIP for the published build architecture |

Only artifacts produced and approved by the protected stable-release workflow
are official releases. Local packages and builds for another architecture are
development artifacts until they pass the same smoke and release gates.

## Development compatibility

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- Electron 43.x;
- `better-sqlite3` rebuilt for the adopted Electron ABI.

Use `npm run test:abi` to check that native module compatibility before running
the full suite.

## AI compatibility

- Codex CLI minimum: `0.145.0`;
- recommended: `0.146.0`;
- verified: `0.145.0` and `0.146.0`;
- newer versions require a successful App Server handshake;
- remote OpenAI-compatible endpoints require HTTPS;
- local Ollama and LM Studio endpoints use loopback.

There are no dedicated native adapters for Anthropic, Gemini or GitHub Copilot
in the current release contract. The Codex App Server remains experimental.
