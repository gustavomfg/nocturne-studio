# Providers and models

[Português do Brasil](providers.pt-BR.md)

## ChatGPT account

Connect a ChatGPT account through the Codex CLI. Nocturne does not receive the
account password or token: it uses the authenticated Codex App Server and lists
the models returned for that account. A ChatGPT subscription does not provide
OpenAI Platform API credits.

Build and Docs use this Codex path. Review can use it when no compatible API
model is selected.

## OpenAI-compatible connections

The current provider adapter supports OpenAI API, OpenRouter, DeepSeek, Ollama,
LM Studio and custom endpoints that implement the compatible models and chat
completion resources. Remote endpoints require HTTPS. Plain HTTP is accepted
only for local loopback providers.

The adapter supports model discovery, streaming and cancellation. Tool calling
is not normalized by this adapter and is reported as a limitation. Refresh the
catalog before binding a model to a workspace.

## Credentials and diagnostics

Provider keys are encrypted with the operating-system secure storage. They are
represented in SQLite by opaque references, never returned to the renderer, and
excluded from backups and diagnostic reports.

The diagnostic panel distinguishes unavailable endpoints, rejected credentials,
missing models, timeouts, rate limits, invalid responses and insufficient API
credits. A provider failure is recoverable and does not imply that the main
application has crashed.

## Common cases

- **Insufficient credits:** add balance to the API account or choose another
  provider; a ChatGPT plan and API billing are separate.
- **Invalid key:** replace the provider credential.
- **Missing model:** refresh the catalog and select an available model.
- **Rate limit:** wait for the provider's limit window.
- **Local endpoint offline:** start Ollama or LM Studio and verify its loopback
  address.
