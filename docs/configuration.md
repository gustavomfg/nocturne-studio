# Configuration

[Português do Brasil](configuration.pt-BR.md)

Open **Settings** to configure the selected model, Codex sandbox and approval
policy, diagnostic logging and provider connections. The interface keeps the
theme dark in the current release.

## Providers and model bindings

Provider definitions and their opaque credential references are stored locally.
Refresh a provider's model catalog, then bind an available model to a workspace.
Removing a provider also removes its stored credential reference; it does not
remove unrelated conversations or workspace history.

## Workspace trust

Selecting a folder is an authorization decision, not just a recent-path entry.
Restored or moved workspaces must be selected again before file, Git, memory or
AI operations can use them.

## Diagnostics

Detailed logging is opt-in. Logs and exported diagnostic reports are sanitized,
local and bounded. Review a report before sharing it outside the device.
