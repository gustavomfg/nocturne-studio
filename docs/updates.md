# Updates

[Português do Brasil](updates.pt-BR.md)

The updater checks for releases only in a packaged application. Development
builds and package smoke tests do not contact the release service.

## User flow

1. After startup, the packaged app checks for an update and repeats the check
   every six hours without overlapping requests.
2. When a release is available, the app displays a non-modal notice with a
   sanitized version and notes. The notice does not interrupt current work.
3. The user can inspect the release notes and start the download from the
   notice or from Settings → Updates.
4. Download progress is shown inside Nocturne and by the operating system; the
   current app remains usable.
5. `electron-updater` validates the downloaded artifact.
6. Installation happens after an explicit restart action or when the app
   quits, according to the updater's normal installation flow.

The update state is owned by the main process and crosses the named `updates`
IPC domain through preload. The renderer hydrates its state with `getState()`
before relying on state-change events. Background failures remain discreet; a
user-started download exposes a retry action.

## Platform targets

Stable releases publish the configured targets for all three platforms:

- Linux AppImage and `tar.gz`, with AppImage as the supported auto-update
  target;
- Windows x64 NSIS installer and `latest.yml` metadata;
- macOS ARM64 DMG and updater ZIP with `latest-mac.yml` metadata.

The auto-update state is `unsupported` for Linux `tar.gz` installations. The
Windows and macOS metadata is generated and published for the configured
targets, but those artifacts are currently unsigned and macOS is not notarized.
Operating-system trust prompts remain part of installation on those platforms.

All v1.0.1 metadata points to the canonical GitHub repository
`gustavomfg/nocturne-studio`, owner `gustavomfg`, release channel `release` and
version `1.0.1`. Package metadata and release metadata are checked before
publication; a checksum does not substitute for a platform signature.

If a download fails, progress is cleared and **Resume download** starts a new
validated attempt. Declining or postponing an update does not remove local data
or disable the current version. Binary installation rollback belongs to the
installer and operating system; Nocturne's responsibility is preserving and
recovering user data during the next startup.

The published `v1.0.0` client embeds the historical
`gustavomfg/Nocturne-Codex` slug. GitHub redirects that slug's API and asset URLs
to `gustavomfg/nocturne-studio`, so it remains a compatibility bridge without
duplicating release metadata or assets. New `v1.0.1` packages embed the
canonical repository directly.
