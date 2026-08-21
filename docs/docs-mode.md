# Docs Mode

[Português do Brasil](docs-mode.pt-BR.md)

Docs Mode keeps analysis, approval and application separate:

1. the agent reads related documentation without writing;
2. it proposes a focused Markdown update;
3. the user selects a Markdown file inside the authorized workspace;
4. Nocturne shows current and proposed content side by side;
5. the user chooses cancel, append, replace or create;
6. the main process requests final confirmation before writing.

Before applying, Nocturne checks the expected file hash. If another program
changed the file after preview, the operation is refused and a new comparison is
required. Writes use a temporary file, synchronization, restrictive permissions
and atomic replacement.

HTML, DOCX and PDF exports depend on Pandoc and are derived copies of the
response; they do not update a source Markdown document incrementally.
