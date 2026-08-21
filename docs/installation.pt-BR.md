# Instalação e requisitos

[English](installation.md)

## Artefatos oficiais

Instale somente artefatos publicados para a release desejada:

- Windows 10/11 x64: instalador NSIS (`.exe`);
- Linux desktop: AppImage ou `tar.gz`;
- macOS: DMG; o atualizador também usa o ZIP correspondente.

A arquitetura publicada é a indicada nos assets da release. Compare checksums
com o manifesto da mesma release. Artefatos estáveis de Windows e macOS devem
ser assinados; o macOS também exige notarização. Manifestos Linux são assinados
com GPG no workflow protegido de release. Um build de validação pode não ter
assinatura e não é uma release estável.

O repositório continua na linha `0.9.5-beta`; o trabalho de prontidão não muda
nem publica a versão.

## Requisitos de IA

Review pode usar um Provider OpenAI-compatible. Build e Docs exigem uma
instalação autenticada do Codex CLI/App Server:

- CLI mínimo suportado: `0.145.0`;
- versão recomendada: `0.146.0`;
- versões verificadas: `0.145.0` e `0.146.0`.

Versões mais novas são detectadas automaticamente, mas o handshake real do App
Server precisa funcionar. O contrato do App Server é experimental.

## Ambiente de desenvolvimento

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- ferramentas nativas compatíveis com `better-sqlite3`.

```bash
npm ci
npm run dev
```

Veja [desenvolvimento](development.pt-BR.md) para validação e empacotamento.
