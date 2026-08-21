# Privacy

[Português do Brasil](privacy.pt-BR.md)

Nocturne Studio is local-first. The local database, conversations, suggestions,
memories, settings and application logs remain on the device under the product
user-data directory.

Content leaves the device only when the user runs a task with a remote provider
or with the authenticated Codex CLI. The request can include the prompt,
selected conversation/context and explicitly attached files. Local providers
receive requests at the configured loopback endpoint.

Provider credentials:

- are kept in the Electron main process;
- are encrypted with the operating-system secure storage;
- never cross the renderer/preload API;
- are not exported to backups or diagnostic reports.

Diagnostics use a random session identifier, bounded fields and redaction of
credentials, prompts, responses, diffs, file contents and sensitive paths.
Performance metrics are aggregate numbers only. The policies of the selected
provider and the Codex service also apply to any content sent to them.

Nocturne Studio is independent and is not an official OpenAI product.
