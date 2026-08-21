# Compatibilidade

[English](compatibility.md)

## Alvos oficiais do aplicativo

| Plataforma | Artefato de release |
| --- | --- |
| Windows 10/11 | instalador NSIS x64 |
| Linux desktop | AppImage ou `tar.gz` da arquitetura publicada |
| macOS | DMG e ZIP do atualizador da arquitetura publicada |

Somente artefatos produzidos e aprovados pelo workflow protegido de release são
releases oficiais. Pacotes locais e builds de outra arquitetura são artefatos
de desenvolvimento até passarem pelos mesmos smoke checks e gates.

## Compatibilidade de desenvolvimento

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- Electron 43.x;
- `better-sqlite3` recompilado para o ABI do Electron adotado.

Use `npm run test:abi` para verificar a compatibilidade do módulo nativo antes
da suíte completa.

## Compatibilidade de IA

- Codex CLI mínimo: `0.145.0`;
- recomendado: `0.146.0`;
- verificado: `0.145.0` e `0.146.0`;
- versões novas exigem handshake bem-sucedido do App Server;
- endpoints OpenAI-compatible remotos exigem HTTPS;
- Ollama e LM Studio locais usam loopback.

Não há adapters nativos dedicados para Anthropic, Gemini ou GitHub Copilot no
contrato atual. O Codex App Server continua experimental.
