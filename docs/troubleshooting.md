# Troubleshooting

[Português do Brasil](troubleshooting.pt-BR.md)

## The app or project does not open

Confirm that the project folder exists and is readable. If it moved, choose
**Locate folder** and authorize the new root. History remains local and readable
while the old root is unavailable, but access to files, Git and AI stays blocked
until explicit reselection.

## Codex is missing or has no models

Install a supported Codex CLI, authenticate it outside Nocturne and run the AI
diagnostic again. A newer CLI must pass the App Server handshake. An absent or
incompatible CLI is a recoverable provider error, not a reason to expose
credentials or continue with an unknown protocol.

## A provider fails

Check the endpoint, HTTPS/loopback rule, credential and model catalog. For
Ollama or LM Studio, start the local service. The diagnostic distinguishes
authentication, credits, rate limits, timeout, unavailable endpoint and invalid
response.

## A run was interrupted

Read the error summary for what was preserved and use **Try again** when the
operation is eligible. Build rollback is offered only when its snapshot and
reported file boundaries make a safe rollback possible.

## Recovery or update failed

Do not delete local database or recovery artifacts. Use the guided recovery or
import a verified backup. For an interrupted update, resume the download; the
current installed version and local data remain the recovery baseline until the
new package is validated.

## Diagnostics

Use **Settings > Diagnostics** to copy or export a sanitized report. Review any
log before sharing it. Reports must not contain credentials, prompts, project
contents, diffs or private paths.
