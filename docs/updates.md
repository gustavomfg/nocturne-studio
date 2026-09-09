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

The update state is owned by the main process and crosses the named
`updates` IPC domain through preload. The renderer hydrates its state with
`getState()` before relying on state-change events. Background failures remain
discreet; a user-started download exposes a retry action.

The auto-update state is `unsupported` for Linux tar.gz installations. Linux
AppImage is the supported Linux auto-update target. Windows NSIS and macOS
DMG/ZIP remain represented in the configuration, but stable publication of
those platforms requires the signing and release jobs described in the
maintainer workflow.

If a download fails, progress is cleared and **Resume download** starts a new
validated attempt. Declining or postponing an update does not remove local data
or disable the current version. Binary installation rollback belongs to the
installer and operating system; Nocturne's responsibility is preserving and
recovering user data during the next startup.

Stable releases use the stable `release` metadata policy. Prerelease settings
are not a promise that every beta will receive every stable build; the
`1.0.0` to `1.0.1` path is rehearsed with real updater metadata before the
stable release. The current stable workflow publishes Linux only. Expanding
stable publication to signed Windows and macOS artifacts is a separate release
pipeline follow-up. See the maintainer [release workflow](github-actions.md).

The published `v1.0.0` client embeds the historical `gustavomfg/Nocturne-Codex`
slug. GitHub redirects that slug's API and asset URLs to
`gustavomfg/nocturne-studio`, so it remains a compatibility bridge without
duplicating release metadata or assets. New `v1.0.1` packages embed the canonical
repository directly and no longer depend on the legacy slug.
