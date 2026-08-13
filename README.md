> **Documentation for Nocturne Studio v0.9.5-beta**

# 🌙 Nocturne Studio

> **An AI-powered software engineering workspace built around your project—not your prompts.**

<p align="center">
  <img src="docs/images/Captura_de_tela_20260803_145710.png" alt="Nocturne Studio — nova conversa">
</p>

Nocturne Studio is a local-first software engineering workspace that helps developers understand, review, document and evolve software projects using contextual artificial intelligence.

Rather than treating AI as the product, Nocturne Studio treats the **workspace** as the product.

Knowledge, architecture, documentation, repositories and conversations remain connected, allowing artificial intelligence to work from project context instead of isolated prompts.

---

# ✨ Highlights

- 🧠 Local Second Brain
- 👁️ Context-aware Awareness System
- 🤖 Multiple AI Providers
- 📝 Intelligent Review Mode
- 📚 Persistent Project Knowledge
- 🔐 Secure Credential Storage
- ⚡ Typed IPC Communication
- 🏗️ Local-first Architecture
- 📦 Provider Abstraction Layer

---

# 📸 Workspace

<p align="center">
  <img src="docs/images/Captura_de_tela_20260803_145404.png" alt="Workspace ativo">
</p>

Nocturne Studio combines conversations, repositories, project context and engineering tools into a single workspace.

Instead of switching between multiple applications, developers interact with their software from one consistent environment.

---

# 📊 Project Health

<p align="center">
  <img src="docs/images/Captura_de_tela_20260803_145512.png" alt="Project Health" width="40%">
</p>

Review Mode evaluates software quality across multiple engineering dimensions.

Current analysis includes:

- Architecture
- Security
- Tests
- Performance
- Documentation
- Maintainability

Suggestions remain reviewable before any modification is applied. Each
structured review reconciles the current findings with the previous snapshot:
new and persistent items stay visible, severity changes are reported, and open
items no longer supported by the current evidence are resolved. Accepted or
deferred decisions remain under user control.

---

# 💡 AI Suggestions

<p align="center">
  <img src="docs/images/Captura_de_tela_20260803_145522.png" alt="AI Suggestions" width="35%">
</p>

Suggestions are grouped by severity and category, making technical debt easier to prioritize and review.

Each recommendation records evidence, confidence, source, responsible party,
severity, rationale and decision history—not only **what** should change, but
also **why**.

---

# 🔍 Suggestion Details

<p align="center">
  <img src="docs/images/Captura_de_tela_20260803_145547.png" alt="Suggestion Detail" width="55%">
</p>

Every suggestion contains detailed engineering information, including:

- Problem and impact
- Technical reasoning
- Expected benefits
- Affected files
- Proposed implementation
- Suggested commit message

Developers always remain responsible for reviewing and approving changes.

---

# 🌳 Git Integration

<p align="center">
  <img src="docs/images/Captura_de_tela_20260803_145447.png" alt="Commit Proposal" width="45%">
</p>

Approved changes can be prepared for version control with integrated Git support, allowing developers to review staged files and commit messages before creating commits.

---

# 🤖 AI Providers

<p align="center">
  <img src="docs/images/Captura_de_tela_20260803_145624.png" alt="Providers" width="45%">
</p>

Nocturne Studio separates provider integrations from the workspace itself.

Currently available integrations include:

- ChatGPT accounts through the Codex CLI
- OpenAI API
- OpenRouter API
- DeepSeek API
- Ollama
- LM Studio
- Custom OpenAI-compatible endpoints

Anthropic and other provider-specific adapters are planned, but are not
implemented in this release. Additional providers can be integrated without
changing the workspace architecture.

---

# 🏛️ Core Principles

## Workspace First

Projects are the primary source of context.

Artificial intelligence supports the workspace instead of defining it.

---

## Knowledge First

Approved information becomes structured project knowledge.

Knowledge belongs to developers and remains reusable across future work.

---

## Provider Agnostic

No provider should become a dependency of the workspace.

Developers remain free to choose the best model for each task.

---

## Local First

Workspace data stays local whenever possible.

Artificial intelligence processes requests without owning project knowledge.

---

## Human in Control

Artificial intelligence assists engineering decisions.

Developers remain responsible for reviewing, approving and evolving their software.

---

# 🏗️ Architecture

```text
                    Workspace
                         │
        ┌────────────────┼────────────────┐
        │                │                │
    Second Brain     Sessions      Documents
        │
        ▼
    Awareness
        │
        ▼
 Task Orchestrator
        │
        ▼
  Provider Layer
        │
 ┌──────┴───────────────┐
 │                      │
Codex CLI       OpenAI-compatible
 │                      │
ChatGPT       ┌──────────┼──────────┐
account     APIs      local       custom
           services  runtimes     endpoints
```

Every provider implements the same execution contract, allowing the workspace to remain independent from any specific AI platform.

---

# 🚀 Current Status

Current version

> **v0.9.5-beta**

Implemented:

- Review Mode
- Workspace Memory
- Second Brain
- Awareness explicável por execução
- Secure Provider System
- Credential Vault
- Typed IPC
- Secure Electron Architecture
- Provider Abstraction Layer
- Packaging Pipeline
- Automated CI Validation

Currently under development:

- recursos avançados de Build Mode além do fluxo protegido atual
- recursos avançados de Docs Mode além da comparação e aplicação incremental
- Workspace Automation
- Expanded Provider Capabilities

---

# 🛣️ Roadmap

## v0.9.x

- Complete Provider System
- Expand Workspace execution
- Improve Review Mode
- Continue Build Mode
- Continue Docs Mode

## v1.0

- Stable engineering workspace
- Complete engineering workflow
- Expanded provider ecosystem
- Plugin-ready architecture

---

# 🔧 Codex CLI

Build Mode and Docs Mode currently require Codex CLI.

**Minimum supported version:** `0.145.0`

**Recommended version:** `0.146.0`

Versions newer than the minimum are detected automatically. Nocturne validates
the live App Server handshake before using them, so updating the Codex CLI does
not require changing a dependency version in this project.

---

# 📚 Documentation

- [Installation and compatibility](docs/installation.md)
- [First use](docs/getting-started.md)
- [Providers and ChatGPT account access](docs/providers.md)
- [Review, Build and Docs modes](docs/modes.md)
- [Backup and recovery](docs/backup-and-recovery.md)
- [Updates](docs/updates.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md) and [privacy](docs/privacy.md)
- [1.0 release readiness](docs/release-readiness-1.0.md)
- [Development environment](docs/development.md)

Nocturne Studio remains at `0.9.5-beta`. The 1.0 documents describe release
gates and do not change the installed version by themselves.

---

# 📄 License

This project is open source.

See the repository license for licensing information.
