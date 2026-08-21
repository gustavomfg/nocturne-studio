# Updates

[Português do Brasil](updates.pt-BR.md)

The updater checks for releases only in a packaged application. Development
builds and package smoke tests do not contact the release service.

## User flow

1. After startup, the packaged app checks for an update and repeats the check
   every six hours without overlapping requests.
2. When a release is available, the app displays a sanitized version and notes.
3. Download starts only after confirmation; progress is shown by the operating
   system and the current app remains usable.
4. `electron-updater` validates the downloaded artifact.
5. Installation happens after a second confirmation or when the app quits,
   according to the updater's normal installation flow.

If a download fails, progress is cleared and **Resume download** starts a new
validated attempt. Declining or postponing an update does not remove local data
or disable the current version. Binary installation rollback belongs to the
installer and operating system; Nocturne's responsibility is preserving and
recovering user data during the next startup.

Stable releases use the stable `release` metadata policy. Prerelease settings
are not a promise that every beta will receive every stable build; the
`0.9.5-beta` to `1.0.0` path is rehearsed with real updater metadata before the
stable release. See the maintainer [release workflow](github-actions.md).
