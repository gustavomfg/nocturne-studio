# Privacy

[Português do Brasil](privacy.pt-BR.md)

Nocturne Studio is local-first. The local database, conversations, suggestions,
memories, settings and application logs remain on the device under the product
user-data directory.

Content leaves the device only when the user runs a task with a remote provider
or with the authenticated Codex CLI. The request can include the prompt,
selected conversation/context and explicitly attached files. Local providers
receive requests at the configured loopback endpoint.

Semantic indexing follows the same local-first boundary. The workspace model
binding for embeddings is separate from the chat model binding. Lexical and
structural indexing work without a Provider. Remote embeddings are disabled
unless the workspace explicitly authorizes them; excluded, secret-like and
unsupported files are filtered before they are read by the semantic pipeline.
When remote embeddings are authorized, only approved non-sensitive chunks are
sent, and the resulting vectors remain local in SQLite. Provider failures fall
back to local lexical/structural retrieval.

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
