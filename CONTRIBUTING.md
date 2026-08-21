# Contributing

[Português do Brasil](CONTRIBUTING.pt-BR.md)

Thank you for your interest in contributing to **Nocturne Studio**.

Whether you are fixing a bug, improving documentation, proposing a feature or submitting code, your contribution is appreciated.

---

# Before You Start

Before opening a Pull Request, please:

- Search existing issues and discussions.
- Open an issue for significant behavior changes or new features.
- Keep Pull Requests focused on a single objective.
- Follow the project's architectural principles.

---

# Development Guidelines

## Architecture

The project follows a secure Electron architecture.

Please preserve the separation between:

- Renderer
- Preload
- Main Process

Avoid introducing unnecessary coupling between these layers.

---

## Security

Never commit:

- API keys
- Access tokens
- Local databases
- Logs containing sensitive information
- Personal credentials

Authentication data must never be exposed through the renderer.

---

## Code Quality

Before submitting a Pull Request, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:abi
npm run test:renderer
```

If applicable, also run the project's packaging and smoke validation workflows.

---

# Commit Messages

Conventional Commits are recommended.

Examples:

```text
feat(provider): add provider registry

fix(ipc): validate renderer origin

docs(readme): update architecture overview

refactor(workspace): simplify awareness pipeline
```

---

# Pull Requests

A good Pull Request should:

- clearly describe the change;
- explain the motivation;
- mention possible risks;
- include manual validation steps;
- include screenshots for UI changes.

Small and focused Pull Requests are preferred over large changes.

---

# Development Environment

Recommended environment:

- WebStorm
- Node.js 24 LTS
- npm 11+

The `webstorm` launcher should be available in your system `PATH`.

---

# Project Philosophy

Every contribution should respect the project's design priorities:

1. Security before convenience.
2. Workspace before AI.
3. Knowledge before conversations.
4. Human control before automation.
5. Extensibility before provider-specific implementations.

Thank you for helping improve Nocturne Studio.
