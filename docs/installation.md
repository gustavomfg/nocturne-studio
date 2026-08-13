# Instalação e requisitos

## Pacotes oficiais

Use somente artefatos publicados pela release oficial:

- Windows x64: instalador NSIS `.exe`;
- Linux x64: `.AppImage` ou `.tar.gz`;
- macOS: `.dmg`, com `.zip` usado pelo atualizador.

Compare o arquivo com o manifesto `SHA256SUMS-<plataforma>` da mesma release.
Windows e macOS exigem assinatura do aplicativo; macOS também exige
notarização. O manifesto Linux possui assinatura GPG.

A linha `0.9.5-beta` continua sendo pré-release. Os gates descritos nos planos
1.0 não transformam uma build beta em versão estável.

## Dependência de IA

Review pode usar um Provider OpenAI-compatible configurado. Build e Docs usam o
Codex CLI na linha atual.

- Codex CLI mínimo: `0.145.0`;
- versão recomendada: `0.146.0`;
- versões verificadas: `0.145.0` e `0.146.0`;
- versões mais novas são aceitas automaticamente quando atendem ao mínimo e
  passam pelo handshake do App Server.

O App Server é experimental. A versão mínima é um limite de segurança; a
compatibilidade efetiva é confirmada pelo handshake em tempo de execução. O
smoke `npm run smoke:codex` deve ser executado para homologar uma versão nova
antes de uma release.

## Ambiente de desenvolvimento

Para compilar o projeto:

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- launcher `webstorm` disponível no `PATH`;
- toolchain nativa compatível com `better-sqlite3`.

Execute:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Detalhes adicionais estão em `docs/development.md`.
