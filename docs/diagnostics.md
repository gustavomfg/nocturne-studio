# Diagnostics and privacy

[Português do Brasil](diagnostics.pt-BR.md)

Each launch receives a random session identifier. Local logs are structured and
contain date, session, level, category, event and bounded operational data.

Before writing, the logger removes credential, prompt, content, diff and raw
output fields; masks known token and authorization-header patterns; bounds
strings, lists, objects and nesting; and uses local rotation with restrictive
permissions. Raw Codex App Server traffic is not stored.

In **Settings > Diagnostics**, users can copy or export a sanitized report with
application/runtime versions, platform, architecture, session identifier,
event counts, provider/model counts and timings. It does not contain credentials,
prompts, file contents, diffs or conversation history. Review any local log
before sending it outside the device.
