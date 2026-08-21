# Installation and requirements

[Português do Brasil](installation.pt-BR.md)

## Official artifacts

Install only artifacts published for the intended release:

- Windows 10/11 x64: NSIS installer (`.exe`);
- Linux desktop: AppImage or `tar.gz`;
- macOS: DMG; the updater also uses the matching ZIP artifact.

The published architecture is the one named by the release assets. Compare
checksums with the release manifest. Stable Windows and macOS artifacts must be
signed; macOS also requires notarization. Linux checksum manifests are signed
with GPG in the protected release workflow. A package-validation build is not a
stable release and may be unsigned.

The repository currently remains on `0.9.5-beta`; release-readiness work does
not itself publish or change the version.

## AI requirements

Review can use an OpenAI-compatible provider. Build and Docs require an
authenticated Codex CLI/App Server installation:

- minimum supported Codex CLI: `0.145.0`;
- recommended version: `0.146.0`;
- verified versions: `0.145.0` and `0.146.0`.

Newer versions are detected automatically, but the live App Server handshake
must succeed. The App Server contract is experimental.

## Development setup

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- native build tooling compatible with `better-sqlite3`.

```bash
npm ci
npm run dev
```

See [development](development.md) for validation and packaging commands.
